// Model Fingerprints — Attention Bias Mapping for 2026 Models
// Defines optimal prompt structures and attention weights per model family

import type {
	AttentionBias,
	ModelFingerprint,
	PromptSection,
} from "../core/types.ts";

// ─── Attention Bias Profiles ─────────────────────────────────────────────────

const CLAUDE_BIAS: AttentionBias = {
	systemPrompt: 0.95,
	userFirstParagraph: 0.9,
	userMiddleSection: 0.5,
	userLastParagraph: 0.85,
	examples: 0.8,
	toolDefinitions: 0.75,
};

const GPT_BIAS: AttentionBias = {
	systemPrompt: 0.9,
	userFirstParagraph: 0.85,
	userMiddleSection: 0.6,
	userLastParagraph: 0.9,
	examples: 0.85,
	toolDefinitions: 0.8,
};

const GEMINI_BIAS: AttentionBias = {
	systemPrompt: 0.85,
	userFirstParagraph: 0.8,
	userMiddleSection: 0.7,
	userLastParagraph: 0.85,
	examples: 0.9,
	toolDefinitions: 0.7,
};

const OPEN_SOURCE_BIAS: AttentionBias = {
	systemPrompt: 0.7,
	userFirstParagraph: 0.9,
	userMiddleSection: 0.5,
	userLastParagraph: 0.8,
	examples: 0.75,
	toolDefinitions: 0.6,
};

const DEEPSEEK_BIAS: AttentionBias = {
	systemPrompt: 0.8,
	userFirstParagraph: 0.85,
	userMiddleSection: 0.65,
	userLastParagraph: 0.9,
	examples: 0.85,
	toolDefinitions: 0.7,
};

// ─── Optimal Prompt Structures ───────────────────────────────────────────────

const DEFAULT_STRUCTURE: PromptSection[] = [
	{ type: "system", priority: 1, maxLength: 2000 },
	{ type: "context", priority: 2, maxLength: 4000 },
	{ type: "examples", priority: 3, maxLength: 2000 },
	{ type: "tools", priority: 4, maxLength: 1500 },
	{ type: "instruction", priority: 5, maxLength: 1000 },
	{ type: "query", priority: 6, maxLength: 2000 },
];

const CLAUDE_STRUCTURE: PromptSection[] = [
	{ type: "system", priority: 1, maxLength: 3000 },
	{ type: "examples", priority: 2, maxLength: 2000 },
	{ type: "context", priority: 3, maxLength: 2980 },
	{ type: "tools", priority: 4, maxLength: 2000 },
	{ type: "instruction", priority: 5, maxLength: 1500 },
	{ type: "query", priority: 6, maxLength: 3000 },
];

const GPT_STRUCTURE: PromptSection[] = [
	{ type: "system", priority: 1, maxLength: 2500 },
	{ type: "context", priority: 2, maxLength: 5000 },
	{ type: "tools", priority: 3, maxLength: 2000 },
	{ type: "examples", priority: 4, maxLength: 2000 },
	{ type: "instruction", priority: 5, maxLength: 1000 },
	{ type: "query", priority: 6, maxLength: 2500 },
];

// ─── Model Database ──────────────────────────────────────────────────────────

const FINGERPRINTS: Map<string, ModelFingerprint> = new Map();

function register(fingerprint: ModelFingerprint): void {
	FINGERPRINTS.set(fingerprint.modelName.toLowerCase(), fingerprint);
	// Also register without provider prefix
	const shortName = fingerprint.modelName.split("/").pop()?.toLowerCase();
	if (shortName) FINGERPRINTS.set(shortName, fingerprint);
}

// ── Anthropic Claude ─────────────────────────────────────────────────────────
// As of July 2026: Claude Opus 4.8 (May), Claude Sonnet 5 (Jun),
// Claude Fable 5 & Mythos 5 (Jun), Claude Haiku 4.5 (Oct 2025)
register({
	modelName: "anthropic/claude-opus-4.8",
	provider: "anthropic",
	attentionBiases: CLAUDE_BIAS,
	optimalStructure: CLAUDE_STRUCTURE,
	contextWindow: 1_000_000,
	maxOutputTokens: 65_536,
	inputCostPerMillion: 15.0,
	outputCostPerMillion: 75.0,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

register({
	modelName: "anthropic/claude-sonnet-5",
	provider: "anthropic",
	attentionBiases: CLAUDE_BIAS,
	optimalStructure: CLAUDE_STRUCTURE,
	contextWindow: 1_000_000,
	maxOutputTokens: 65_536,
	inputCostPerMillion: 3.0,
	outputCostPerMillion: 15.0,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

register({
	modelName: "anthropic/claude-opus-4.7",
	provider: "anthropic",
	attentionBiases: CLAUDE_BIAS,
	optimalStructure: CLAUDE_STRUCTURE,
	contextWindow: 1_000_000,
	maxOutputTokens: 65_536,
	inputCostPerMillion: 15.0,
	outputCostPerMillion: 75.0,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

register({
	modelName: "anthropic/claude-opus-4.6",
	provider: "anthropic",
	attentionBiases: CLAUDE_BIAS,
	optimalStructure: CLAUDE_STRUCTURE,
	contextWindow: 1_000_000,
	maxOutputTokens: 65_536,
	inputCostPerMillion: 15.0,
	outputCostPerMillion: 75.0,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

register({
	modelName: "anthropic/claude-opus-4.5",
	provider: "anthropic",
	attentionBiases: CLAUDE_BIAS,
	optimalStructure: CLAUDE_STRUCTURE,
	contextWindow: 200_000,
	maxOutputTokens: 8_192,
	inputCostPerMillion: 15.0,
	outputCostPerMillion: 75.0,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

register({
	modelName: "anthropic/claude-sonnet-4.6",
	provider: "anthropic",
	attentionBiases: CLAUDE_BIAS,
	optimalStructure: CLAUDE_STRUCTURE,
	contextWindow: 1_000_000,
	maxOutputTokens: 65_536,
	inputCostPerMillion: 3.0,
	outputCostPerMillion: 15.0,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

// Keep legacy Claude 4 models
register({
	modelName: "anthropic/claude-4-opus",
	provider: "anthropic",
	attentionBiases: CLAUDE_BIAS,
	optimalStructure: CLAUDE_STRUCTURE,
	contextWindow: 1_000_000,
	maxOutputTokens: 65_536,
	inputCostPerMillion: 15.0,
	outputCostPerMillion: 75.0,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

register({
	modelName: "anthropic/claude-4-sonnet",
	provider: "anthropic",
	attentionBiases: CLAUDE_BIAS,
	optimalStructure: CLAUDE_STRUCTURE,
	contextWindow: 1_000_000,
	maxOutputTokens: 65_536,
	inputCostPerMillion: 3.0,
	outputCostPerMillion: 15.0,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

register({
	modelName: "anthropic/claude-4.6-haiku",
	provider: "anthropic",
	attentionBiases: CLAUDE_BIAS,
	optimalStructure: CLAUDE_STRUCTURE,
	contextWindow: 200_000,
	maxOutputTokens: 8_192,
	inputCostPerMillion: 0.8,
	outputCostPerMillion: 4.0,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

// ── OpenAI GPT ───────────────────────────────────────────────────────────────
// As of July 2026: GPT-5.6 (Jun/Jul 2026) with Luna/Terra/Sol variants,
// GPT-5.5 (Apr 2026), GPT-5.4, GPT-5.3-Codex
register({
	modelName: "openai/gpt-5.6-sol",
	provider: "openai",
	attentionBiases: GPT_BIAS,
	optimalStructure: GPT_STRUCTURE,
	contextWindow: 400_000,
	maxOutputTokens: 64_000,
	inputCostPerMillion: 2.0,
	outputCostPerMillion: 8.0,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

register({
	modelName: "openai/gpt-5.6-terra",
	provider: "openai",
	attentionBiases: GPT_BIAS,
	optimalStructure: GPT_STRUCTURE,
	contextWindow: 400_000,
	maxOutputTokens: 64_000,
	inputCostPerMillion: 1.0,
	outputCostPerMillion: 4.0,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

register({
	modelName: "openai/gpt-5.6-luna",
	provider: "openai",
	attentionBiases: GPT_BIAS,
	optimalStructure: GPT_STRUCTURE,
	contextWindow: 400_000,
	maxOutputTokens: 32_000,
	inputCostPerMillion: 0.4,
	outputCostPerMillion: 1.6,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

register({
	modelName: "openai/gpt-5.5-pro",
	provider: "openai",
	attentionBiases: GPT_BIAS,
	optimalStructure: GPT_STRUCTURE,
	contextWindow: 400_000,
	maxOutputTokens: 64_000,
	inputCostPerMillion: 15.0,
	outputCostPerMillion: 60.0,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

register({
	modelName: "openai/gpt-5.5",
	provider: "openai",
	attentionBiases: GPT_BIAS,
	optimalStructure: GPT_STRUCTURE,
	contextWindow: 400_000,
	maxOutputTokens: 64_000,
	inputCostPerMillion: 3.0,
	outputCostPerMillion: 12.0,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

register({
	modelName: "openai/gpt-5.3-codex",
	provider: "openai",
	attentionBiases: GPT_BIAS,
	optimalStructure: GPT_STRUCTURE,
	contextWindow: 400_000,
	maxOutputTokens: 64_000,
	inputCostPerMillion: 6.0,
	outputCostPerMillion: 24.0,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

// Keep legacy GPT-5 Turbo
register({
	modelName: "openai/gpt-5-turbo",
	provider: "openai",
	attentionBiases: GPT_BIAS,
	optimalStructure: GPT_STRUCTURE,
	contextWindow: 2_000_000,
	maxOutputTokens: 32_768,
	inputCostPerMillion: 10.0,
	outputCostPerMillion: 30.0,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

register({
	modelName: "openai/gpt-5.2",
	provider: "openai",
	attentionBiases: GPT_BIAS,
	optimalStructure: GPT_STRUCTURE,
	contextWindow: 2_000_000,
	maxOutputTokens: 65_536,
	inputCostPerMillion: 5.0,
	outputCostPerMillion: 15.0,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

register({
	modelName: "openai/gpt-4o",
	provider: "openai",
	attentionBiases: GPT_BIAS,
	optimalStructure: GPT_STRUCTURE,
	contextWindow: 128_000,
	maxOutputTokens: 16_384,
	inputCostPerMillion: 2.5,
	outputCostPerMillion: 10.0,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

register({
	modelName: "openai/gpt-4o-mini",
	provider: "openai",
	attentionBiases: GPT_BIAS,
	optimalStructure: GPT_STRUCTURE,
	contextWindow: 128_000,
	maxOutputTokens: 16_384,
	inputCostPerMillion: 0.15,
	outputCostPerMillion: 0.6,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

register({
	modelName: "openai/o3",
	provider: "openai",
	attentionBiases: GPT_BIAS,
	optimalStructure: GPT_STRUCTURE,
	contextWindow: 200_000,
	maxOutputTokens: 100_000,
	inputCostPerMillion: 10.0,
	outputCostPerMillion: 40.0,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

// ── Google Gemini ────────────────────────────────────────────────────────────
register({
	modelName: "google/gemini-3.1-ultra",
	provider: "google",
	attentionBiases: GEMINI_BIAS,
	optimalStructure: DEFAULT_STRUCTURE,
	contextWindow: 2_000_000,
	maxOutputTokens: 65_536,
	inputCostPerMillion: 7.0,
	outputCostPerMillion: 21.0,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

register({
	modelName: "google/gemini-3.1-pro",
	provider: "google",
	attentionBiases: GEMINI_BIAS,
	optimalStructure: DEFAULT_STRUCTURE,
	contextWindow: 2_000_000,
	maxOutputTokens: 65_536,
	inputCostPerMillion: 1.25,
	outputCostPerMillion: 5.0,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

register({
	modelName: "google/gemini-3.1-flash",
	provider: "google",
	attentionBiases: GEMINI_BIAS,
	optimalStructure: DEFAULT_STRUCTURE,
	contextWindow: 1_000_000,
	maxOutputTokens: 8_192,
	inputCostPerMillion: 0.075,
	outputCostPerMillion: 0.3,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

// ── Open Source Models ───────────────────────────────────────────────────────
register({
	modelName: "meta-llama/llama-4-maverick",
	provider: "meta",
	attentionBiases: OPEN_SOURCE_BIAS,
	optimalStructure: DEFAULT_STRUCTURE,
	contextWindow: 1_000_000,
	maxOutputTokens: 16_384,
	inputCostPerMillion: 0.2,
	outputCostPerMillion: 0.6,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

register({
	modelName: "mistralai/mistral-large-2",
	provider: "mistral",
	attentionBiases: OPEN_SOURCE_BIAS,
	optimalStructure: DEFAULT_STRUCTURE,
	contextWindow: 128_000,
	maxOutputTokens: 16_384,
	inputCostPerMillion: 2.0,
	outputCostPerMillion: 6.0,
	supportsStreaming: true,
	supportsVision: false,
	supportsToolUse: true,
});

register({
	modelName: "deepseek/deepseek-v3",
	provider: "deepseek",
	attentionBiases: DEEPSEEK_BIAS,
	optimalStructure: DEFAULT_STRUCTURE,
	contextWindow: 128_000,
	maxOutputTokens: 8_192,
	inputCostPerMillion: 0.27,
	outputCostPerMillion: 1.1,
	supportsStreaming: true,
	supportsVision: false,
	supportsToolUse: true,
});

// ── Qwen ─────────────────────────────────────────────────────────────────────
const QWEN_BIAS: AttentionBias = {
	systemPrompt: 0.85,
	userFirstParagraph: 0.85,
	userMiddleSection: 0.65,
	userLastParagraph: 0.9,
	examples: 0.85,
	toolDefinitions: 0.8,
};

register({
	modelName: "qwen/qwen3.6-plus",
	provider: "qwen",
	attentionBiases: QWEN_BIAS,
	optimalStructure: DEFAULT_STRUCTURE,
	contextWindow: 128_000,
	maxOutputTokens: 8_192,
	inputCostPerMillion: 0.8,
	outputCostPerMillion: 2.0,
	supportsStreaming: true,
	supportsVision: true,
	supportsToolUse: true,
});

// ── Budget Models (MiniMax-class for VCM routing) ────────────────────────────
register({
	modelName: "minimax/m2.7",
	provider: "minimax",
	attentionBiases: OPEN_SOURCE_BIAS,
	optimalStructure: DEFAULT_STRUCTURE,
	contextWindow: 32_000,
	maxOutputTokens: 4_096,
	inputCostPerMillion: 0.05,
	outputCostPerMillion: 0.1,
	supportsStreaming: true,
	supportsVision: false,
	supportsToolUse: false,
});

// ── Local OpenAI-Compatible Runtime (LM Studio / Ollama / llama.cpp) ───
// Zero-cost entry so budget math and the /providers endpoint have a profile
// for local models. Use `local/auto` as the model id when routing through a
// local runtime; the real served model id (e.g. google/gemma-4-e2b) also
// works — cost just computes as $0 because no fingerprint matches it.
register({
	modelName: "local/auto",
	provider: "local",
	attentionBiases: OPEN_SOURCE_BIAS,
	optimalStructure: DEFAULT_STRUCTURE,
	contextWindow: 128_000,
	maxOutputTokens: 8_192,
	inputCostPerMillion: 0,
	outputCostPerMillion: 0,
	supportsStreaming: true,
	supportsVision: false,
	supportsToolUse: true,
});

// ─── Lookup Functions ────────────────────────────────────────────────────────

export function getModelFingerprint(
	modelName: string,
): ModelFingerprint | undefined {
	return FINGERPRINTS.get(modelName.toLowerCase());
}

export function getAllFingerprints(): ModelFingerprint[] {
	return [...FINGERPRINTS.values()];
}

export function getCheapestModel(
	options: {
		needsVision?: boolean;
		needsToolUse?: boolean;
		minContextWindow?: number;
	} = {},
): ModelFingerprint | undefined {
	const candidates = getAllFingerprints().filter((fp) => {
		if (options.needsVision && !fp.supportsVision) return false;
		if (options.needsToolUse && !fp.supportsToolUse) return false;
		if (options.minContextWindow && fp.contextWindow < options.minContextWindow)
			return false;
		return true;
	});

	return candidates.sort(
		(a, b) => a.inputCostPerMillion - b.inputCostPerMillion,
	)[0];
}

export function reorderPromptForModel(
	modelName: string,
	sections: Map<string, string>,
): string {
	const fingerprint = getModelFingerprint(modelName);
	const structure = fingerprint?.optimalStructure ?? DEFAULT_STRUCTURE;

	const ordered: string[] = [];
	const sorted = [...structure].sort((a, b) => a.priority - b.priority);

	for (const section of sorted) {
		const content = sections.get(section.type);
		if (content) {
			const truncated =
				content.length > section.maxLength
					? `${content.slice(0, section.maxLength).replace(/\s+$/, "")}...`
					: content;
			ordered.push(truncated);
		}
	}

	return ordered.join("\n\n");
}

// ─── Dynamic Fingerprint Catalog ─────────────────────────────────────────────

/**
 * Remote catalog URL for model fingerprints. When a model is not found
 * in the local FINGERPRINTS map, the system fetches its fingerprint from
 * this catalog and caches it locally for future lookups.
 *
 * The catalog is a simple JSON endpoint that returns an array of
 * ModelFingerprint objects. It is fetched lazily — only when a model
 * is not found locally.
 */
const FINGERPRINT_CATALOG_URL =
	"https://raw.githubusercontent.com/Markgatcha/llm-guardian/main/src/providers/fingerprints-catalog.json";

/** Cache for dynamically fetched fingerprints. */
const dynamicCache: Map<string, ModelFingerprint> = new Map();
/** Timestamp of the last catalog fetch (ms). */
let lastCatalogFetch = 0;
/** Catalog fetch interval — don't re-fetch more than once per hour. */
const CATALOG_REFRESH_INTERVAL = 60 * 60 * 1000;

/**
 * Fetch model fingerprints from the remote catalog and cache them locally.
 * This allows new models to be supported without a code release.
 *
 * The catalog is fetched at most once per hour. If the fetch fails,
 * the local cache is used (which may be empty for new models).
 */
export async function refreshFingerprintCatalog(): Promise<void> {
	const now = Date.now();
	if (now - lastCatalogFetch < CATALOG_REFRESH_INTERVAL) {
		return; // Don't re-fetch too frequently.
	}

	try {
		const response = await fetch(FINGERPRINT_CATALOG_URL, {
			signal: AbortSignal.timeout(5000), // 5s timeout
		});
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		const fingerprints = (await response.json()) as ModelFingerprint[];
		for (const fp of fingerprints) {
			const key = fp.modelName.toLowerCase();
			if (!FINGERPRINTS.has(key)) {
				dynamicCache.set(key, fp);
				// Also register without provider prefix.
				const shortName = fp.modelName.split("/").pop()?.toLowerCase();
				if (shortName) {
					dynamicCache.set(shortName, fp);
				}
			}
		}
		lastCatalogFetch = now;
	} catch {
		// Catalog fetch failed — fall back to local fingerprints only.
		// This is non-fatal; new models just won't have fingerprints.
	}
}

/**
 * Get a model fingerprint, checking both local and dynamic caches.
 * If the model is not found locally, attempts to fetch from the remote
 * catalog (cached for 1 hour).
 */
export async function getModelFingerprintAsync(
	modelName: string,
): Promise<ModelFingerprint | null> {
	// Check local fingerprints first (fastest).
	const local = getModelFingerprint(modelName);
	if (local) return local;

	// Check dynamic cache.
	const key = modelName.toLowerCase();
	if (dynamicCache.has(key)) {
		return dynamicCache.get(key)!;
	}

	// Try fetching from the remote catalog.
	await refreshFingerprintCatalog();
	return dynamicCache.get(key) ?? null;
}

export default {
	getModelFingerprint,
	getAllFingerprints,
	getCheapestModel,
	reorderPromptForModel,
	refreshFingerprintCatalog,
	getModelFingerprintAsync,
};
