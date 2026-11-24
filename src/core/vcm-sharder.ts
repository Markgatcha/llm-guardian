// VCM Sharding Engine — Context Skeleton Analysis & Knowledge Shard Injection
// Uses local analysis to identify high-relevance context shards
// Reduces context bloat by 60-90% while preserving semantic coherence

import {
	type Unit,
	assembleUnits,
	splitUnits,
	unitPriors,
} from "./query-extractor.ts";
import { Bm25, DupIndex, identifiers, makeDoc, termsOf } from "./text-index.ts";
import { estimateTokens } from "./token-counter.ts";
import type {
	ChatMessage,
	ContextSkeleton,
	EntityNode,
	FlowEdge,
	KnowledgeShard,
	ShardingResult,
} from "./types.ts";

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

	// File paths. Extract candidate path-like tokens with a simple
	// char-class repeat (no quantifier-then-alternation, so CodeQL's
	// js/polynomial-redos does not flag it), then keep only those that end
	// in a known source extension via a quantifier-free test.
	const filePaths: string[] = [];
	const pathTokenRe = /[\w./-]+/g;
	let pathMatch: RegExpExecArray | null = pathTokenRe.exec(content);
	while (pathMatch !== null) {
		const tok = pathMatch[0];
		if (/\.(?:ts|tsx|js|jsx|py|go|rs|md|json|yaml)$/.test(tok)) {
			filePaths.push(tok);
		}
		pathMatch = pathTokenRe.exec(content);
	}
	if (filePaths.length > 0) {
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

// ─── Candidates ──────────────────────────────────────────────────────────────

/**
 * Messages longer than this are split into units (log lines, JSON records,
 * paragraphs) and selected piece by piece. The old sharder could only take a
 * message whole or leave it out, so one big paste bigger than the budget was
 * dropped entirely and the conversation collapsed to its skeleton.
 */
const CHUNK_TOKENS = 220;

/** Candidates scoring below this are not worth a slot even with budget to spare. */
const SCORE_FLOOR = 0.1;

/**
 * `maxTokens` is a ceiling, not a target. Beyond what is forced, a candidate
 * earns a slot only by being relevant to the question, severe/unusual, or part
 * of the last few turns (conversational continuity). Without this gate, spare
 * budget fills with whatever scores highest on recency alone, and the result
 * costs more tokens for no extra facts.
 */
const MIN_RELEVANCE = 0.15;
/** ...and must also be competitive with the best match (a fraction of it). */
const REL_RATIO = 0.35;
const MIN_PRIOR = 1.5;
const RECENT_TURNS = 4;

interface Candidate {
	msg: number;
	/** Index within the message's units, or -1 when the message is one piece. */
	unit: number;
	text: string;
	tokens: number;
	/** Query relevance, ~0–1.8. */
	rel: number;
	score: number;
	forced: boolean;
}

// ─── Main Sharding Function ──────────────────────────────────────────────────

export function shardContext(
	messages: ChatMessage[],
	query: string,
	options: { maxTokens?: number; minRelevance?: number } = {},
): ShardingResult {
	const { maxTokens = 4000 } = options;
	const n = messages.length;

	const msgTokens = messages.map((m) => estimateTokens(m.content));
	const totalTokens = msgTokens.reduce((a, b) => a + b, 0);

	let lastUser = -1;
	for (let i = n - 1; i >= 0; i--) {
		if (messages[i]?.role === "user") {
			lastUser = i;
			break;
		}
	}
	if (lastUser === -1) lastUser = n - 1;

	// 1. Candidates: whole small messages, units of big ones.
	const unitsByMsg = new Map<number, Unit[]>();
	const cands: Candidate[] = [];
	const priors: number[] = [];
	for (let i = 0; i < n; i++) {
		const m = messages[i] as ChatMessage;
		if (m.role !== "system" && (msgTokens[i] as number) > CHUNK_TOKENS) {
			const units = splitUnits(m.content);
			if (units.length >= 4) {
				unitsByMsg.set(i, units);
				const p = unitPriors(units);
				units.forEach((u, j) => {
					cands.push({ msg: i, unit: j, text: u.text, tokens: estimateTokens(u.text) + 1, rel: 0, score: 0, forced: false });
					priors.push(p[j] as number);
				});
				continue;
			}
		}
		cands.push({ msg: i, unit: -1, text: m.content, tokens: msgTokens[i] as number, rel: 0, score: 0, forced: false });
		priors.push(0);
	}

	// 2. Score every candidate against the question (BM25 + identifier hits),
	// blended with recency and, for pieces of big messages, a salience prior.
	const docs = cands.map((c) => makeDoc(c.text));
	const bm = new Bm25(docs);
	// Bounded: callers pass the whole last user message, which may be a huge paste.
	const q = query.slice(-2000);
	const qTerms = [...new Set(termsOf(q))];
	const qIds = identifiers(q);
	const raw = qTerms.length ? cands.map((_, i) => bm.score(qTerms, i)) : [];
	// Normalize against everything EXCEPT the question's own message, which is
	// its own best match and would squash every real candidate toward zero.
	const maxRaw = raw.length
		? Math.max(0, ...raw.filter((_, i) => (cands[i] as Candidate).msg !== lastUser))
		: 0;

	cands.forEach((c, i) => {
		let rel = maxRaw > 0 ? (raw[i] as number) / maxRaw : 0;
		const lower = c.text.toLowerCase();
		for (const id of qIds) if (lower.includes(id)) rel += 0.8;
		c.rel = rel;
		const recency = n > 1 ? c.msg / (n - 1) : 1;
		c.score = 0.6 * Math.min(1.8, rel) + 0.3 * recency + 0.12 * Math.min(2.5, priors[i] as number);
	});

	// 3. Selection. Forced first: system prompts, the question, and the turn
	// right before it (the thing the question usually refers to).
	let remaining = maxTokens;
	const chosen: Candidate[] = [];
	const picked = new Set<Candidate>();
	const dup = new DupIndex(0.85);
	let shardsDeduped = 0;

	const index = new Map<Candidate, number>();
	cands.forEach((c, i) => index.set(c, i));
	const docOf = (c: Candidate) => docs[index.get(c) as number] as ReturnType<typeof makeDoc>;
	const take = (c: Candidate, force = false): boolean => {
		if (picked.has(c)) return false;
		if (!force && c.tokens > remaining) return false;
		picked.add(c);
		chosen.push(c);
		remaining -= c.tokens;
		dup.add(docOf(c));
		return true;
	};

	for (const c of cands) {
		if (messages[c.msg]?.role === "system" && c.tokens <= remaining) {
			c.forced = true;
			take(c);
		}
	}
	for (const c of cands) {
		if (c.msg !== lastUser) continue;
		const units = unitsByMsg.get(c.msg);
		// The question is the whole message, or the tail of a big one.
		if (c.unit === -1 || (units && c.unit === units.length - 1)) {
			c.forced = true;
			take(c, true);
		}
	}
	const before = lastUser - 1;
	if (before >= 0 && messages[before]?.role !== "system") {
		for (const c of cands) {
			if (c.msg === before && c.unit === -1 && c.tokens <= maxTokens * 0.35) {
				c.forced = true;
				take(c);
			}
		}
	}

	let maxRel = 0;
	for (const c of cands) if (c.msg !== lastUser) maxRel = Math.max(maxRel, c.rel);
	const relBar = Math.max(MIN_RELEVANCE, REL_RATIO * maxRel);
	const earns = (c: Candidate) =>
		c.rel >= relBar ||
		(priors[index.get(c) as number] as number) >= MIN_PRIOR ||
		// Continuity applies to whole turns, not to pieces of a big paste.
		(c.unit === -1 && c.msg > n - 1 - RECENT_TURNS);

	const ranked = cands.filter((c) => !picked.has(c)).sort((a, b) => b.score - a.score);
	for (const c of ranked) {
		if (remaining <= 0) break;
		if (c.score < SCORE_FLOOR || !earns(c)) continue;
		if (dup.isDup(docOf(c))) {
			shardsDeduped++;
			continue;
		}
		take(c);
	}

	// 4. Keep a question and its answer together: a selected user turn pulls in
	// the assistant reply that follows it, and vice versa, when budget allows.
	const pairCap = maxTokens * 0.25;
	for (const c of [...chosen].sort((a, b) => b.score - a.score)) {
		if (c.unit !== -1) continue;
		const role = messages[c.msg]?.role;
		const mate = role === "user" ? c.msg + 1 : role === "assistant" ? c.msg - 1 : -1;
		const mateMsg = messages[mate];
		if (!mateMsg || mateMsg.role === "system") continue;
		const wanted = role === "user" ? mateMsg.role === "assistant" : mateMsg.role === "user";
		if (!wanted) continue;
		for (const m of cands) {
			if (m.msg === mate && m.unit === -1 && !picked.has(m) && m.tokens <= Math.min(remaining, pairCap)) {
				if (dup.isDup(docOf(m))) continue;
				take(m);
			}
		}
	}

	// 5. Assemble per message, in conversation order.
	const assemble = (): Map<number, { content: string; rel: number }> => {
		const parts = new Map<number, { whole: boolean; units: Set<number>; rel: number }>();
		for (const c of chosen) {
			const p = parts.get(c.msg) ?? { whole: false, units: new Set<number>(), rel: 0 };
			if (c.unit === -1) p.whole = true;
			else p.units.add(c.unit);
			p.rel = Math.max(p.rel, c.rel);
			parts.set(c.msg, p);
		}
		const out = new Map<number, { content: string; rel: number }>();
		for (const [i, p] of parts) {
			const units = unitsByMsg.get(i);
			const content =
				p.whole || !units || p.units.size === units.length
					? (messages[i] as ChatMessage).content
					: assembleUnits(units, p.units);
			out.set(i, { content, rel: p.rel });
		}
		return out;
	};

	let built = assemble();
	let used = 0;
	for (const v of built.values()) used += estimateTokens(v.content);
	// Gap markers cost a few tokens the greedy pass did not see: shed the
	// least valuable pieces until the result honors the budget.
	if (used > maxTokens) {
		const droppable = chosen.filter((c) => !c.forced).sort((a, b) => a.score - b.score);
		for (const c of droppable) {
			if (used <= maxTokens) break;
			chosen.splice(chosen.indexOf(c), 1);
			built = assemble();
			used = 0;
			for (const v of built.values()) used += estimateTokens(v.content);
		}
	}

	const shards: KnowledgeShard[] = [...built.entries()]
		.sort(([a], [b]) => a - b)
		.map(([i, v]) => ({
			id: `shard-${i}`,
			content: v.content,
			relevanceScore: Math.min(1, v.rel),
			sourceIndices: [i],
			tokens: estimateTokens(v.content),
		}));

	const shardedTokens = shards.reduce((sum, sh) => sum + sh.tokens, 0);
	return {
		injectedContext: shards.map((sh) => sh.content).join("\n\n"),
		shards,
		originalTokens: totalTokens,
		shardedTokens,
		compressionRatio: totalTokens > 0 ? shardedTokens / totalTokens : 1,
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
