// VCM Sharding Engine — Context Skeleton Analysis & Knowledge Shard Injection
// Uses local analysis to identify high-relevance context shards
// Reduces context bloat by 60-90% while preserving semantic coherence

import { estimateTokens } from "./folding-engine.ts";
import type {
	ChatMessage,
	ContextSkeleton,
	EntityNode,
	FlowEdge,
	KnowledgeShard,
	ShardingResult,
} from "./types.ts";

// ─── Skeleton Builder ────────────────────────────────────────────────────────

function buildSkeleton(messages: ChatMessage[]): ContextSkeleton {
	const entities = new Map<string, EntityNode>();
	const flow: FlowEdge[] = [];
	let totalTokens = 0;

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		const tokens = estimateTokens(msg.content);
		totalTokens += tokens;

		// Extract entities from message
		const extracted = extractEntitiesFromMessage(msg.content);
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
		topic,
		entities: sortedEntities,
		flow,
		totalTokens,
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

		// Entity overlap with query
		const msgEntities = extractEntitiesFromMessage(message.content);
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
): KnowledgeShard[] {
	// Sort by combined score descending
	const sorted = [...scored].sort((a, b) => b.combinedScore - a.combinedScore);

	const shards: KnowledgeShard[] = [];
	let remainingBudget = tokenBudget;

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

	// Include highest-scoring non-system messages
	const nonSystem = sorted.filter((s) => s.message.role !== "system");
	for (const msg of nonSystem) {
		const tokens = estimateTokens(msg.message.content);
		if (tokens <= remainingBudget && msg.combinedScore > 0.15) {
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

	return shards;
}

// ─── Main Sharding Function ──────────────────────────────────────────────────

export function shardContext(
	messages: ChatMessage[],
	query: string,
	options: { maxTokens?: number; minRelevance?: number } = {},
): ShardingResult {
	const { maxTokens = 4000 } = options;

	// Build context skeleton
	const skeleton = buildSkeleton(messages);

	// Score all messages
	const scored = scoreMessages(messages, query, skeleton);

	// Assemble shards within token budget
	const shards = assembleShards(scored, maxTokens);

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
