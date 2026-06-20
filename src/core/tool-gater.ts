// Tool Gating / Lazy Tool-Schema Loading
//
// Inspired by the Hermes-agent finding that ~73% of each LLM call is fixed
// overhead before any useful work — dominated by tool definitions and static
// system context. When an agent exposes a large tool catalog, sending every
// tool's JSON schema on every call burns prompt tokens (and output tokens, since
// the model reasons over all of them) for tools that are irrelevant to the
// current turn.
//
// `gateTools()` scores each tool by keyword / description overlap with the
// latest user query and keeps only the top N (default 8) or those above a
// relevance floor. This is lazy tool-schema loading: only the relevant subset
// is sent to the provider.
//
// Zero-LLM-call, sub-millisecond. Used by the orchestrator between sharding
// and model selection.

import type { ToolDefinition } from "./types.ts";

/** Default maximum number of tools kept after gating. */
const DEFAULT_MAX_TOOLS = 8;
/** Minimum relevance score (0-1) for a tool to be kept regardless of rank. */
const RELEVANCE_FLOOR = 0.05;

// Common stop-words to ignore when extracting query terms.
const STOP_WORDS = new Set([
	"a", "an", "the", "and", "or", "but", "for", "to", "of", "in", "on", "at",
	"by", "with", "from", "is", "are", "was", "were", "be", "been", "being",
	"this", "that", "these", "those", "it", "its", "as", "if", "so", "do",
	"does", "did", "can", "could", "should", "would", "will", "i", "you",
	"me", "my", "your", "please", "want", "need", "help", "use", "using",
]);

/**
 * Extract meaningful query terms (lowercased, stop-words removed, len > 2).
 */
function queryTerms(query: string): Set<string> {
	return new Set(
		query
			.toLowerCase()
			.split(/[^a-z0-9_.-]+/i)
			.filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
	);
}

/**
 * Tokenize a tool's name + description into a set of lowercased terms.
 */
function toolTerms(tool: ToolDefinition): Set<string> {
	const blob = `${tool.function.name} ${tool.function.description} ${
		JSON.stringify(tool.function.parameters ?? {})
	}`.toLowerCase();
	return new Set(blob.split(/[^a-z0-9_.-]+/i).filter((w) => w.length > 2));
}

/**
 * Score a single tool's relevance to the query via term overlap (Jaccard-like).
 * Returns a value in [0, 1].
 */
export function scoreToolRelevance(tool: ToolDefinition, terms: Set<string>): number {
	if (terms.size === 0) return 0;
	const tTerms = toolTerms(tool);
	if (tTerms.size === 0) return 0;
	let overlap = 0;
	for (const t of terms) {
		if (tTerms.has(t)) overlap++;
	}
	// Weighted overlap: fraction of query terms found in the tool, with a small
	// bonus for the tool name itself matching a query term.
	const nameMatch = terms.has(tool.function.name.toLowerCase()) ? 0.15 : 0;
	return Math.min(1, overlap / terms.size + nameMatch);
}

export interface GateToolsOptions {
	/** Max tools to keep (default 8). */
	maxTools?: number;
	/** Minimum relevance to keep a tool (default 0.05). */
	relevanceFloor?: number;
}

/**
 * Gate a tool catalog down to the query-relevant subset.
 *
 * Returns the kept tools and how many were removed. If the query is empty or
 * `tools` has <= maxTools entries, gating is a no-op (returns all tools, 0
 * removed) — lazy gating only kicks in when there's something to gain.
 *
 * @example
 *   const { tools, removed } = gateTools(allTools, lastUserMessage, { maxTools: 8 });
 */
export function gateTools(
	tools: ToolDefinition[] | undefined,
	query: string,
	options: GateToolsOptions = {},
): { tools: ToolDefinition[] | undefined; removed: number } {
	if (!tools || tools.length === 0) return { tools, removed: 0 };

	const { maxTools = DEFAULT_MAX_TOOLS, relevanceFloor = RELEVANCE_FLOOR } = options;

	// No-op when the catalog is already small — avoids overhead and avoids
	// accidentally dropping tools on simple requests.
	if (tools.length <= maxTools) return { tools, removed: 0 };

	const terms = queryTerms(query);
	// If we can't extract any signal from the query, don't gate (safer to send
	// all tools than to arbitrarily keep 8 with no basis).
	if (terms.size === 0) return { tools, removed: 0 };

	const scored = tools
		.map((tool) => ({ tool, score: scoreToolRelevance(tool, terms) }))
		.filter((s) => s.score >= relevanceFloor)
		.sort((a, b) => b.score - a.score);

	// If filtering by the floor removed everything (unlikely), fall back to the
	// top-N by raw score so the model always has *some* tools.
	const pool = scored.length > 0 ? scored : tools
		.map((tool) => ({ tool, score: scoreToolRelevance(tool, terms) }))
		.sort((a, b) => b.score - a.score);

	const kept = pool.slice(0, maxTools).map((s) => s.tool);
	return { tools: kept, removed: tools.length - kept.length };
}

export default { gateTools, scoreToolRelevance };
