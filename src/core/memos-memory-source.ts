// MemOS Memory-Pack Adapter — optional AI Trio integration for LLM-Guardian
//
// This module bridges llm-guardian's VCM Sharding step to the memos
// (`@mem-os/sdk`) sibling repo. It produces a token-budgeted memory slice
// (a MemOS TOON context pack) that the orchestrator injects as a
// high-relevance context shard.
//
// DECOUPLING: Guardian takes NO hard dependency on @mem-os/sdk. The package
// is imported lazily (dynamic import) only when a pack is actually built,
// so the rest of Guardian builds and runs fine without memos installed. This
// keeps the two sibling repos independently publishable while still letting
// them compose at runtime.
//
// ACTIVATION: The server wires this in automatically when MemOS env vars are
// present (MEMOS_NAMESPACE / MEMOS_STORAGE_PATH). Without them, the guardian
// runs standalone — no memos import, no overhead. If memos is installed but
// errors at request time, the pack build fails soft (request proceeds without
// memory) rather than 500-ing.
//
// Usage (manual):
//   const source = await createMemOSMemorySource({ namespace: "default" });
//   const pack = await source.getPack("refactor vcm sharder", 1200);
//   // → pass `pack` as `request.memoryPack` to orchestrate()
//
// Usage (server-side, automatic):
//   const pack = await buildRequestMemoryPack(userQuery, 1200);
//   // returns the TOON pack string, or null if memos isn't configured/available

import { estimateTokens } from "./token-counter.ts";

/** Options for constructing a MemOS-backed memory source. */
export interface MemOSMemorySourceOptions {
	/** MemOS namespace to query. Defaults to "default". */
	namespace?: string;
	/** Path to the memos SQLite store. Maps to MemOS `dbPath`. */
	dbPath?: string;
	/** Alias for `dbPath` (kept for backwards compatibility). */
	storagePath?: string;
	/** Embedding provider URL (optional; MemOS falls back to keyword search). */
	embeddingProvider?: string;
	/** Override the import specifier for @mem-os/sdk (testing / monorepo). */
	importSpecifier?: string;
}

/** A pluggable memory source. Guardian only depends on this interface. */
export interface MemoryPackSource {
	/** Build a compact, token-budgeted memory pack for the given query. */
	getPack(query: string, tokenBudget: number): Promise<string>;
}

/**
 * Create a memory source backed by MemOS. Loads `@mem-os/sdk` on demand.
 *
 * @throws if @mem-os/sdk cannot be resolved or MemOS fails to initialize.
 */
export async function createMemOSMemorySource(
	opts: MemOSMemorySourceOptions = {},
): Promise<MemoryPackSource> {
	const specifier = opts.importSpecifier ?? "@mem-os/sdk";

	// Lazy import — Guardian does not statically depend on memos.
	const mod = (await import(specifier)) as {
		MemOS: new (config: Record<string, unknown>) => MemOSLike;
	};
	const { MemOS } = mod;

	const memos = new MemOS({
		dbPath: opts.dbPath ?? opts.storagePath,
		embeddingProvider: opts.embeddingProvider,
	});
	await memos.init();

	const namespace = opts.namespace ?? "default";

	return {
		async getPack(query: string, tokenBudget: number): Promise<string> {
			const pack = await memos.contextPack({
				query,
				namespace,
				tokenBudget,
			});
			// Serialize to TOON (60-90% smaller than JSON) for injection.
			return packToToon(pack);
		},
	};
}

/** Minimal structural type for the bits of MemOS we use (avoids a static dep). */
interface MemOSLike {
	init(): Promise<void>;
	contextPack(opts: {
		query: string;
		namespace: string;
		tokenBudget: number;
	}): Promise<MemOSContextPack>;
}

interface MemOSContextPackItem {
	id: string;
	score: number;
	trust: string;
	source: string;
	updatedAt: string;
	tags: string[];
	content: string;
}

interface MemOSContextPack {
	query: string;
	namespace: string;
	tokenBudget: number;
	tokensSaved: number;
	items: MemOSContextPackItem[];
}

/**
 * Serialize a MemOS context pack to TOON (Token-Optimized Object Notation) —
 * a compact pipe-delimited format. Mirrors memos' own `packToToon` so the
 * output is compatible with consumers that expect the AI Trio schema header.
 */
export function packToToon(pack: MemOSContextPack): string {
	const lines: string[] = [];
	lines.push("# ai-trio.memos.context-pack.v1");
	lines.push(
		`# toon:pipe-delimited|q=${pack.query}|n=${pack.namespace}|b=${pack.tokenBudget}|s=${pack.tokensSaved}`,
	);
	lines.push("# fields: id|score|trust|source|updatedAt|tags|content");
	for (const item of pack.items) {
		const tags = item.tags.join(";");
		// Pipe-delimited; escape any pipes in content to keep the format stable.
		const content = item.content.replace(/\|/g, "\\|");
		lines.push(
			`${item.id}|${item.score.toFixed(3)}|${item.trust}|${item.source}|${item.updatedAt}|${tags}|${content}`,
		);
	}
	return lines.join("\n");
}

/** Estimate the tokens a packed string will occupy (for metrics). */
export function estimatePackTokens(pack: string): number {
	return estimateTokens(pack);
}

// ─── Server-side automatic wiring ────────────────────────────────────────────
// A lazily-constructed, process-wide MemOS source. MemOS `init()` is expensive,
// so we build it once and reuse it across requests. It only initializes when
// MemOS env vars are present AND the package resolves, so standalone guardian
// instances never pay for it.

let cachedSource: MemoryPackSource | null = null;
let sourceInitPromise: Promise<MemoryPackSource | null> | null = null;
let memosDisabled = false;

/**
 * Resolve (and cache) the process-wide MemOS memory source. Returns null when
 * MemOS isn't configured (no env vars) or can't be loaded — callers treat null
 * as "no memory injection", never as a hard error.
 */
export function getMemoryPackSource(): Promise<MemoryPackSource | null> {
	if (memosDisabled) return Promise.resolve(null);
	if (cachedSource) return Promise.resolve(cachedSource);
	if (sourceInitPromise) return sourceInitPromise;

	const namespace = process.env.MEMOS_NAMESPACE;
	const dbPath = process.env.MEMOS_STORAGE_PATH;
	if (!namespace && !dbPath) {
		// Not configured — stay standalone. Don't retry every request.
		memosDisabled = true;
		return Promise.resolve(null);
	}

	sourceInitPromise = createMemOSMemorySource({
		namespace,
		dbPath,
		embeddingProvider: process.env.MEMOS_EMBEDDING_PROVIDER,
	})
		.then((source) => {
			cachedSource = source;
			return source;
		})
		.catch((err) => {
			// memos isn't installed or failed to init — run without memory.
			console.warn(
				`[guardian] MemOS memory source unavailable, continuing without ` +
					`memory injection: ${err instanceof Error ? err.message : String(err)}`,
			);
			memosDisabled = true;
			sourceInitPromise = null;
			return null;
		});

	return sourceInitPromise;
}

/**
 * Build a MemOS TOON memory pack for the current request and return it as a
 * ready-to-inject string. Returns null if memos isn't configured or errors —
 * the caller proceeds without memory injection. This is the single integration
 * point the server calls before orchestration.
 *
 * @param query        The user query used to retrieve relevant memories.
 * @param tokenBudget  Target token budget for the retrieved pack.
 */
export async function buildRequestMemoryPack(
	query: string,
	tokenBudget: number,
): Promise<string | null> {
	const source = await getMemoryPackSource();
	if (!source || !query.trim()) return null;
	try {
		return await source.getPack(query.trim(), tokenBudget);
	} catch (err) {
		console.warn(
			`[guardian] MemOS pack build failed, continuing without memory: ` +
				`${err instanceof Error ? err.message : String(err)}`,
		);
		return null;
	}
}

export default { createMemOSMemorySource, packToToon, estimatePackTokens, getMemoryPackSource, buildRequestMemoryPack };
