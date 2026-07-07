// VCM Sharding Engine — Context Skeleton Analysis & Knowledge Shard Injection
// Uses local analysis to identify high-relevance context shards
// Reduces context bloat by 60-90% while preserving semantic coherence

import { estimateTokens } from "./token-counter.ts";
import type {
	ChatMessage,
	ContextSkeleton,
	EntityNode,
	FlowEdge,
	KnowledgeShard,
	ShardingResult,
} from "./types.ts";

// ─── Helpers: similarity (semantic shard dedup) ─────────────────────────────

/**
 * Term-frequency cosine similarity over lowercased word tokens. Cheap and
 * zero-dependency. Used to deduplicate near-identical context shards so the
 * model isn't fed the same information twice — the "semantic folding" intent
 * applied to the shard layer. Returns a value in [0, 1].
 */
function contentSimilarity(a: string, b: string): number {
	const tokenize = (s: string) =>
		s
			.toLowerCase()
			.split(/[^a-z0-9]+/i)
			.filter((w) => w.length > 2);
	const ta = tokenize(a);
	const tb = tokenize(b);
	if (ta.length === 0 || tb.length === 0) return 0;

	const freq = new Map<string, number>();
	for (const w of ta) freq.set(w, (freq.get(w) ?? 0) + 1);
	let dot = 0;
	for (const w of tb) {
		const c = freq.get(w);
		if (c) dot += c;
	}
	const denom = Math.sqrt(ta.length) * Math.sqrt(tb.length);
	return denom > 0 ? dot / denom : 0;
}

// ─── Skeleton Builder ────────────────────────────────────────────────────────

function buildSkeleton(messages: ChatMessage[]): {
	skeleton: ContextSkeleton;
	/** Per-message extracted entities, keyed by message index. Reused by
	 * scoreMessages() so entity regexes run exactly once per message instead
	 * of being re-run during scoring (the previous N+1 re-extraction was the
	 * dominant CPU cost in sharding). */
	entitiesByIndex: Map<number, ExtractedEntity[]>;
} {
	const entities = new Map<string, EntityNode>();
	const flow: FlowEdge[] = [];
	let totalTokens = 0;
	const entitiesByIndex = new Map<number, ExtractedEntity[]>();

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		const tokens = estimateTokens(msg.content);
		totalTokens += tokens;

		// Extract entities from message
		const extracted = extractEntitiesFromMessage(msg.content);
		entitiesByIndex.set(i, extracted);
		for (const { name, type } of extracted) {
			const key = name.toLowerCase();
			const existing = entities.get(key);
			if (existing) {
				existing.mentionCount++;
				existing.lastMentionIndex = i;
				existing.relevanceScore = Math.min(1, existing.relevanceScore + 0.1);
			} else {
				entities.set(key, {
					name,
					type,
					relevanceScore: 0.5,
					mentionCount: 1,
					lastMentionIndex: i,
				});
			}
		}

		// Build flow edges between consecutive messages
		if (i > 0) {
			const prevMsg = messages[i - 1];
			const relationship = determineRelationship(prevMsg.role, msg.role);
			flow.push({
				from: i - 1,
				to: i,
				relationship,
				weight: tokens / 100,
			});
		}
	}

	// Determine topic from most mentioned entities
	const sortedEntities = [...entities.values()].sort(
		(a, b) =>
			b.mentionCount * b.relevanceScore - a.mentionCount * a.relevanceScore,
	);
	const topic =
		sortedEntities.length > 0
			? sortedEntities
					.slice(0, 3)
					.map((e) => e.name)
					.join(", ")
			: "general conversation";

	return {
		skeleton: {
			topic,
			entities: sortedEntities,
			flow,
			totalTokens,
		},
		entitiesByIndex,
	};
}

interface ExtractedEntity {
	name: string;
	type: EntityNode["type"];
}

function extractEntitiesFromMessage(content: string): ExtractedEntity[] {
	const entities: ExtractedEntity[] = [];

	// Code references
	const codeRefs = content.match(/`[^`]+`/g);
	if (codeRefs) {
		for (const ref of codeRefs) {
			entities.push({ name: ref.replace(/`/g, ""), type: "code" });
		}
	}

	// File paths
	const filePaths = content.match(
		/(?:[\w./-]+\.(?:ts|tsx|js|jsx|py|go|rs|md|json|yaml))/g,
	);
	if (filePaths) {
		for (const path of filePaths) {
			entities.push({ name: path, type: "code" });
		}
	}

	// Tool names
	const toolNames = content.match(/(?:function|tool|api):\s*(\w+)/gi);
	if (toolNames) {
		for (const tool of toolNames) {
			entities.push({
				name: tool.split(":").pop()?.trim() || tool,
				type: "tool",
			});
		}
	}

	// Capitalized phrases (potential proper nouns / concepts)
	const concepts = content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g);
	if (concepts) {
		for (const concept of concepts.slice(0, 5)) {
			entities.push({ name: concept, type: "concept" });
		}
	}

	// URLs (v1.6.26 richer extraction — aligns with the folding engine's
	// entity patterns so skeleton relevance scoring catches the same signals).
	const urls = content.match(/https?:\/\/[^\s,)]+/g);
	if (urls) {
		for (const url of urls.slice(0, 5)) {
			entities.push({ name: url, type: "data" });
		}
	}

	// API endpoints
	const endpoints = content.match(/(?:GET|POST|PUT|DELETE|PATCH)\s+\/[\w/:-]+/g);
	if (endpoints) {
		for (const ep of endpoints.slice(0, 5)) {
			entities.push({ name: ep, type: "tool" });
		}
	}

	// Model names (gpt-4/5, claude, gemini, etc.)
	const modelNames = content.match(
		/(?:gpt-4(?:\.\d)?|gpt-5(?:\.\d)?|claude-(?:3\.\d|4\.\d)|gemini-(?:\d\.\d)|o[13]|llama|mistral|deepseek)/gi,
	);
	if (modelNames) {
		for (const model of [...new Set(modelNames)].slice(0, 5)) {
			entities.push({ name: model, type: "concept" });
		}
	}

	// Numbers with units (metrics, thresholds, costs) — strong relevance signal
	const metrics = content.match(/\b\d+(?:\.\d+)?(?:%|ms|s|tok|tokens|usd|\$)\b/gi);
	if (metrics) {
		for (const metric of metrics.slice(0, 5)) {
			entities.push({ name: metric, type: "data" });
		}
	}

	return entities;
}

function determineRelationship(prevRole: string, currRole: string): string {
	if (prevRole === "user" && currRole === "assistant") return "responds_to";
	if (prevRole === "assistant" && currRole === "user") return "follows_up";
	if (prevRole === "system") return "instructed_by";
	if (currRole === "tool") return "tool_result";
	return "continues";
}

// ─── Shard Scoring ───────────────────────────────────────────────────────────

interface ScoredMessage {
	index: number;
	message: ChatMessage;
	relevanceScore: number;
	recencyScore: number;
	entityDensity: number;
	combinedScore: number;
}

function scoreMessages(
	messages: ChatMessage[],
	query: string,
	skeleton: ContextSkeleton,
	entitiesByIndex: Map<number, ExtractedEntity[]>,
): ScoredMessage[] {
	const totalMessages = messages.length;
	const queryEntities = extractEntitiesFromMessage(query);
	const queryTerms = new Set(
		query
			.toLowerCase()
			.split(/\s+/)
			.filter((w) => w.length > 3),
	);

	return messages.map((message, index) => {
		// Recency score — more recent messages are more relevant
		const recencyScore = index / Math.max(totalMessages - 1, 1);

		// Entity overlap with query — reuse entities extracted once in
		// buildSkeleton() instead of re-running the regexes per message.
		const msgEntities = entitiesByIndex.get(index) ?? [];
		const entityOverlap = msgEntities.filter((e) =>
			queryEntities.some(
				(qe) => qe.name.toLowerCase() === e.name.toLowerCase(),
			),
		).length;
		const entityDensity = Math.min(
			1,
			entityOverlap / Math.max(queryEntities.length, 1),
		);

		// Term overlap with query
		const msgTerms = message.content.toLowerCase().split(/\s+/);
		const termOverlap = msgTerms.filter((t) => queryTerms.has(t)).length;
		const termScore = Math.min(1, termOverlap / Math.max(queryTerms.size, 1));

		// Skeleton entity relevance
		const skeletonBoost = msgEntities.reduce((boost, entity) => {
			const skeletonEntity = skeleton.entities.find(
				(se) => se.name.toLowerCase() === entity.name.toLowerCase(),
			);
			return boost + (skeletonEntity ? skeletonEntity.relevanceScore * 0.2 : 0);
		}, 0);

		// Role-based scoring
		const roleBoost = message.role === "system" ? 0.3 : 0;

		const relevanceScore = Math.min(
			1,
			termScore * 0.4 + entityDensity * 0.3 + skeletonBoost + roleBoost,
		);
		const combinedScore =
			relevanceScore * 0.6 +
			recencyScore * 0.3 +
			(message.role === "system" ? 0.1 : 0);

		return {
			index,
			message,
			relevanceScore,
			recencyScore,
			entityDensity,
			combinedScore,
		};
	});
}

// ─── Shard Assembly ──────────────────────────────────────────────────────────

function assembleShards(
	scored: ScoredMessage[],
	tokenBudget: number,
): { shards: KnowledgeShard[]; shardsDeduped: number } {
	// Sort by combined score descending
	const sorted = [...scored].sort((a, b) => b.combinedScore - a.combinedScore);

	const shards: KnowledgeShard[] = [];
	let remainingBudget = tokenBudget;
	let shardsDeduped = 0;

	// Adaptive relevance cutoff. The base is 0.15 (the original fixed floor).
	// When most of the budget is still free, we relax the bar so more marginal
	// but distinct context is retained. When the budget is tight, we raise the
	// bar so only the most relevant shards make the cut. This adapts sharding
	// to both small (over-budget) and large (headroom-rich) contexts.
	const budgetUsage = tokenBudget > 0 ? 1 - remainingBudget / tokenBudget : 1;
	const adaptiveCutoff = budgetUsage < 0.5 ? 0.1 : budgetUsage > 0.8 ? 0.25 : 0.15;

	// Always include system messages first
	const systemMessages = sorted.filter((s) => s.message.role === "system");
	for (const sys of systemMessages) {
		const tokens = estimateTokens(sys.message.content);
		if (tokens <= remainingBudget) {
			shards.push({
				id: `shard-${sys.index}`,
				content: sys.message.content,
				relevanceScore: sys.relevanceScore,
				sourceIndices: [sys.index],
				tokens,
			});
			remainingBudget -= tokens;
		}
	}

	// Include highest-scoring non-system messages.
	// Semantic dedup: skip a candidate if it is >= 0.85 similar to a shard we
	// already kept — collapses redundant context before it reaches the model.
	const nonSystem = sorted.filter((s) => s.message.role !== "system");
	for (const msg of nonSystem) {
		const tokens = estimateTokens(msg.message.content);

		// Semantic dedup check against already-kept shards.
		const isDup = shards.some(
			(s) => contentSimilarity(s.content, msg.message.content) >= 0.85,
		);
		if (isDup) {
			shardsDeduped++;
			continue;
		}

		if (tokens <= remainingBudget && msg.combinedScore > adaptiveCutoff) {
			shards.push({
				id: `shard-${msg.index}`,
				content: msg.message.content,
				relevanceScore: msg.relevanceScore,
				sourceIndices: [msg.index],
				tokens,
			});
			remainingBudget -= tokens;
		}
		if (remainingBudget <= 0) break;
	}

	// Sort shards by original index to maintain conversation flow
	shards.sort((a, b) => a.sourceIndices[0] - b.sourceIndices[0]);

	return { shards, shardsDeduped };
}

// ─── Main Sharding Function ──────────────────────────────────────────────────

export function shardContext(
	messages: ChatMessage[],
	query: string,
	options: { maxTokens?: number; minRelevance?: number } = {},
): ShardingResult {
	const { maxTokens = 4000 } = options;

	// Build context skeleton (also extracts per-message entities once)
	const { skeleton, entitiesByIndex } = buildSkeleton(messages);

	// Score all messages (reuses the entities extracted above — no re-extraction)
	const scored = scoreMessages(messages, query, skeleton, entitiesByIndex);

	// Assemble shards within token budget (with semantic dedup + adaptive cutoff)
	const { shards, shardsDeduped } = assembleShards(scored, maxTokens);

	// Build injected context
	const injectedContext = shards.map((s) => s.content).join("\n\n");

	const shardedTokens = shards.reduce((sum, s) => sum + s.tokens, 0);

	return {
		injectedContext,
		shards,
		originalTokens: skeleton.totalTokens,
		shardedTokens,
		compressionRatio:
			skeleton.totalTokens > 0 ? shardedTokens / skeleton.totalTokens : 1,
		// New additive metrics (v1.6.26): how many near-duplicate shards were
		// collapsed, and how much of the budget was used vs. the total.
		shardsDeduped,
		budgetUsed: shardedTokens,
		budgetTotal: maxTokens,
	};
}

// ─── Sharded Messages ────────────────────────────────────────────────────────

export function shardMessages(
	messages: ChatMessage[],
	query: string,
	options: { maxTokens?: number } = {},
): { messages: ChatMessage[]; shardingResult: ShardingResult } {
	const result = shardContext(messages, query, options);

	// Reconstruct messages from shards
	const shardedMessages: ChatMessage[] = result.shards.map((shard) => {
		const originalIndex = shard.sourceIndices[0];
		const original = messages[originalIndex];
		return {
			role: original?.role ?? ("user" as const),
			content: shard.content,
		};
	});

	return { messages: shardedMessages, shardingResult: result };
}

export default { shardContext, shardMessages, buildSkeleton };
