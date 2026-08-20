// Response Cache — Skip provider calls for identical optimized requests
//
// After all optimization stages (folding, sharding, tool gating, prompt
// caching), if the final message set + model + tools are identical to a
// previous request, we can skip the provider call entirely and return the
// cached response. This is especially valuable for:
//   - Repeated user prompts in chat sessions
//   - Deterministic function-call responses
//   - Token cost savings on identical re-requests

// Bun 1.4: Bun.sha256 is a native, zero-copy SHA-256 implementation that
// avoids the node:crypto wrapper overhead. ~2-3x faster than crypto.createHash.

import type { ChatMessage } from "./types.ts";

export const DEFAULT_TTL_MS = 300_000; // 5 minutes
export const DEFAULT_MAX_SIZE = 1_000;

/**
 * Extract the real provider identity from a model ID.
 *
 * Model IDs follow OpenRouter's "provider/model-name" format:
 *   "anthropic/claude-4-opus" → "anthropic"
 *   "openai/gpt-5" → "openai"
 *   "meta-llama/llama-4" → "meta-llama"
 *
 * Unprefixed model names (rare) fall back to "openrouter" because the gateway
 * routes through OpenRouter and we cannot know which upstream provider served
 * the response.
 */
export function providerFromModel(modelId: string): string {
	const idx = modelId.indexOf("/");
	return idx > 0 ? modelId.slice(0, idx) : "openrouter";
}

/** An entry stored in the response cache. */
export interface CacheEntry {
	content: string;
	model: string;
	/**
	 * Provider that served this response (extracted from the model ID, e.g.
	 * "openai" from "openai/gpt-4o", or "openrouter" for unprefixed model
	 * names).
	 */
	provider: string;
	/** Token usage at cache time. */
	usage: { promptTokens: number; completionTokens: number; totalTokens: number };
	/** When this entry was created (ms). */
	createdAt: number;
	/** When this entry expires (ms). */
	expiresAt: number;
	/** Number of times this entry has been served from cache. */
	hitCount: number;
}

/** Configuration for the response cache. */
export interface ResponseCacheConfig {
	/** Maximum number of entries to keep. Default: 1000. */
	maxSize?: number;
	/** Time-to-live in milliseconds. Default: 300_000 (5 minutes). */
	ttlMs?: number;
}

/**
 * In-memory LRU response cache for LLM completions.
 *
 * @example
 * ```ts
 * const cache = new ResponseCache({ ttlMs: 60_000 });
 * const key = cache.buildKey("claude-3-5-sonnet", messages, tools);
 * const cached = cache.get(key);
 * if (cached) return cached;
 * const response = await callProvider(...);
 * cache.set(key, response);
 * ```
 */
export class ResponseCache {
	private readonly cache: Map<string, CacheEntry> = new Map();
	private readonly maxSize: number;
	private readonly ttlMs: number;

	// Counter for lazy TTL sweeps triggered on get().
	private getCounter: number = 0;

	constructor(config: ResponseCacheConfig = {}) {
		this.maxSize = Math.max(1, config.maxSize ?? DEFAULT_MAX_SIZE);
		this.ttlMs = Math.max(1, config.ttlMs ?? DEFAULT_TTL_MS);
	}

	/**
	 * Build a deterministic cache key from the request parameters.
	 *
	 * The key includes: model, tools (by name), and the full message
	 * content. This ensures that any change in the optimized request
	 * produces a different key.
	 */
	buildKey(
		model: string,
		messages: ChatMessage[],
		tools?: unknown[],
	): string {
		const toolNames =
			tools
				?.map((t) => {
					if (t && typeof t === "object") {
						if ("name" in t && typeof (t as { name: string }).name === "string") {
							return (t as { name: string }).name;
						}
						if (
							"function" in t &&
							(t as { function?: { name: string } }).function?.name
						) {
							return (t as { function: { name: string } }).function.name;
						}
					}
					return "";
				})
				.sort()
				.join(",") ?? "";
		const msgContent = messages
			.map((m) => `${m.role}:${m.content}`)
			.join("|");
		// Bun 1.4: Bun.SHA256 (class-based) is a native, zero-copy SHA-256
		// implementation that avoids the node:crypto wrapper overhead.
		// ~2-3x faster than crypto.createHash for short strings like cache keys.
		return new Bun.SHA256().update(
			`${model}|${toolNames}|${msgContent}`,
		).digest("hex");
	}

	/**
	 * Look up a cache entry by key. Returns null if not found or expired.
	 * Performs a lazy TTL sweep on each get to opportunistically prune
	 * expired entries without a background timer.
	 */
	get(key: string): CacheEntry | null {
		const entry = this.cache.get(key);
		if (!entry) return null;

		const now = Date.now();

		// Check expiration.
		if (now > entry.expiresAt) {
			this.cache.delete(key);
			return null;
		}

		// Lazy TTL sweep: every 100 gets, prune all expired entries.
		// This avoids the overhead of a setInterval timer while keeping
		// the cache from growing unbounded with stale entries.
		this.getCounter++;
		if (this.getCounter % 100 === 0 && this.cache.size > this.maxSize * 0.8) {
			this.sweepExpired();
		}

		// Update hit count and move to end (LRU).
		entry.hitCount += 1;
		this.cache.delete(key);
		this.cache.set(key, entry);
		return entry;
	}

	/**
	 * Opportunistic sweep that removes all expired entries.
	 * Called lazily from get() when the cache is approaching capacity.
	 */
	private sweepExpired(): void {
		const now = Date.now();
		for (const [k, v] of this.cache) {
			if (now > v.expiresAt) {
				this.cache.delete(k);
			}
		}
	}

	/**
	 * Store a response in the cache.
	 */
	set(
		key: string,
		content: string,
		model: string,
		// Provider identity of the cached response — preserved so cache hits
		// report the real provider (from the model ID), never the router name.
		provider: string,
		usage: { promptTokens: number; completionTokens: number; totalTokens: number },
		options?: { ttlMs?: number },
	): void {
		// Sweep expired entries first — this may free space without eviction.
		this.sweepExpired();

		// Batch-evict oldest entries if at capacity. Evicting a small batch
		// (5% of maxSize, min 1) amortizes the Map.keys().next() overhead
		// instead of evicting one-at-a-time on every set() call under
		// sustained load.
		const evictCount = Math.max(1, Math.ceil(this.maxSize * 0.05));
		for (let i = 0; i < evictCount && this.cache.size >= this.maxSize; i++) {
			const firstKey = this.cache.keys().next().value;
			if (firstKey === undefined) break;
			this.cache.delete(firstKey);
		}
		const now = Date.now();
		const ttl = options?.ttlMs ?? DEFAULT_TTL_MS;
		const entry: CacheEntry = {
			content,
			model,
			provider,
			usage,
			createdAt: now,
			expiresAt: now + ttl,
			hitCount: 0,
		};
		this.cache.set(key, entry);
	}

	/**
	 * Remove a specific entry from the cache.
	 */
	delete(key: string): boolean {
		return this.cache.delete(key);
	}

	/**
	 * Clear all entries from the cache.
	 */
	clear(): void {
		this.cache.clear();
	}

	/**
	 * Get the current cache size.
	 */
	size(): number {
		return this.cache.size;
	}

	/**
	 * Get cache statistics for monitoring.
	 */
	stats(): {
		size: number;
		maxSize: number;
		totalHits: number;
		hitRate: number;
	} {
		let totalHits = 0;
		for (const entry of this.cache.values()) {
			totalHits += entry.hitCount;
		}
		const totalRequests = totalHits + this.cache.size;
		return {
			size: this.cache.size,
			maxSize: this.maxSize,
			totalHits,
			hitRate: totalRequests > 0 ? totalHits / totalRequests : 0,
		};
	}
}

/** Singleton instance for the orchestrator. */
let singleton: ResponseCache | null = null;

/**
 * Get the global ResponseCache singleton.
 * Called by the orchestrator to share cache state across requests.
 */
export function getResponseCache(): ResponseCache {
	if (!singleton) {
		singleton = new ResponseCache();
	}
	return singleton;
}

/**
 * Reset the singleton (useful for tests).
 */
export function resetResponseCache(): void {
	singleton = null;
}

/** Default singleton instance, re-exported as a named export for convenience. */
export const responseCache = new ResponseCache();
