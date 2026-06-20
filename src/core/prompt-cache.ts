// Prompt Caching — stable cacheable prefix structuring
//
// Anthropic prompt caching gives ~90% input-token cost reduction on cache hits
// (reads priced at 10% of base). OpenAI gives 50% on cached prefixes >= 1024
// tokens (automatic). The key requirement for BOTH: the prefix must be STABLE
// across requests — system prompt, static policy, and tool definitions must
// come BEFORE the volatile content (latest user turn), and nothing in the
// prefix can change between calls.
//
// `structureForCaching()` reorders messages into a cache-friendly layout and
// attaches Anthropic `cache_control: { type: "ephemeral" }` breakpoints on the
// last block of the stable prefix. The breakpoint tells Anthropic where the
// cacheable region ends.
//
// This is additive: callers that don't request caching get unchanged behavior.

import { estimateTokens } from "./token-counter.ts";
import type { ChatMessage } from "./types.ts";

/**
 * Minimum stable-prefix size (in tokens) before caching is worth structuring.
 * Anthropic requires >= 1024 tokens for Sonnet/Opus; OpenAI requires >= 1024.
 * We use 1024 as the floor for both.
 */
const MIN_CACHEABLE_PREFIX_TOKENS = 1024;

/**
 * A message with an optional Anthropic cache_control marker attached. The
 * marker is passed through to the Anthropic API by the adapter.
 */
export interface CacheableMessage extends ChatMessage {
	/** Anthropic ephemeral cache breakpoint (set on the last stable block). */
	cache_control?: { type: "ephemeral" };
}

export interface StructureForCachingResult {
	/** Reordered messages, stable prefix first, volatile content last. */
	messages: CacheableMessage[];
	/** Whether the prefix was large enough to be worth caching. */
	cachingStructured: boolean;
	/** Token count of the stable prefix. */
	prefixTokens: number;
	/** Token count of the volatile suffix (non-cacheable). */
	suffixTokens: number;
}

/**
 * Reorder messages into a cache-friendly layout and attach cache breakpoints.
 *
 * Layout:
 *   [system messages...] [prior conversation turns...] [latest user turn]
 *
 * The cacheable prefix = system + all but the final user message. The final
 * user message is the volatile suffix. When the prefix is >= 1024 tokens, a
 * `cache_control: { type: "ephemeral" }` breakpoint is placed on the last
 * message of the prefix so Anthropic caches everything up to and including it.
 *
 * Original message ORDER among the prefix messages is preserved — we only move
 * the genuinely volatile content to the end, and we only do that when there's a
 * trailing non-system message. We do NOT reorder mid-conversation history (that
 * would break coherence); the "stable vs volatile" split is purely system/early
 * turns vs the latest turn.
 *
 * @param messages - The post-optimization messages (after folding/sharding).
 * @param options.enableCaching - When false, return messages unchanged.
 */
export function structureForCaching(
	messages: ChatMessage[],
	options: { enableCaching?: boolean } = {},
): StructureForCachingResult {
	const { enableCaching = true } = options;

	if (!enableCaching || messages.length === 0) {
		return {
			messages: messages as CacheableMessage[],
			cachingStructured: false,
			prefixTokens: 0,
			suffixTokens: 0,
		};
	}

	// Find the index of the LAST user message — that's the volatile boundary.
	let lastUserIndex = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "user") {
			lastUserIndex = i;
			break;
		}
	}

	// No user message, or it's the only message → nothing to split.
	if (lastUserIndex <= 0) {
		return {
			messages: messages as CacheableMessage[],
			cachingStructured: false,
			prefixTokens: 0,
			suffixTokens: 0,
		};
	}

	const prefix = messages.slice(0, lastUserIndex);
	const suffix = messages.slice(lastUserIndex);

	const prefixTokens = prefix.reduce((s, m) => s + estimateTokens(m.content), 0);
	const suffixTokens = suffix.reduce((s, m) => s + estimateTokens(m.content), 0);

	// Only structure + add breakpoints when the prefix is large enough to be
	// worth caching (< 1024 tokens and Anthropic/OpenAI won't cache it anyway).
	if (prefixTokens < MIN_CACHEABLE_PREFIX_TOKENS) {
		return {
			messages: messages as CacheableMessage[],
			cachingStructured: false,
			prefixTokens,
			suffixTokens,
		};
	}

	// Build the cacheable layout: prefix with a breakpoint on its LAST message,
	// then the volatile suffix. Order within each part is preserved.
	const reordered: CacheableMessage[] = prefix.map((m, i) => {
		const cacheable: CacheableMessage = { ...m };
		if (i === prefix.length - 1) {
			cacheable.cache_control = { type: "ephemeral" };
		}
		return cacheable;
	});
	reordered.push(...(suffix as CacheableMessage[]));

	return {
		messages: reordered,
		cachingStructured: true,
		prefixTokens,
		suffixTokens,
	};
}

/**
 * Anthropic beta header for token-efficient tool use. When tools are present,
 * adding this header compacts tool definitions/outputs for 14-70% output-token
 * savings (scales with the number of tool definitions). The adapter should
 * include this header on the request when `tools` is non-empty.
 */
export const TOKEN_EFFICIENT_TOOLS_BETA_HEADER = "token-efficient-tools-2025";

/**
 * Determine whether the token-efficient-tools beta header should be applied.
 * It's worth it whenever there are tool definitions to compact.
 */
export function shouldUseTokenEfficientTools(
	tools: unknown[] | undefined,
): boolean {
	return !!tools && tools.length > 0;
}

export { MIN_CACHEABLE_PREFIX_TOKENS };

export default { structureForCaching, shouldUseTokenEfficientTools };
