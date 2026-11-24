// Semantic Folding Engine — EDH (Entity-Dense Headlinese) Distillation
// Converts raw text into compressed, high-density semantic representations
// Target: <50ms local execution

import { Bm25, DupIndex, type Doc, identifiers, makeDoc, termsOf } from "./text-index.ts";
import { estimateTokens } from "./token-counter.ts";
import type { ChatMessage, EntityHeadline, FoldingResult } from "./types.ts";

// ─── Entity Extraction ───────────────────────────────────────────────────────

const ACTION_VERBS = [
	"create",
	"delete",
	"update",
	"refactor",
	"build",
	"fix",
	"deploy",
	"configure",
	"analyze",
	"optimize",
	"implement",
	"design",
	"review",
	"test",
	"debug",
	"migrate",
	"integrate",
	"validate",
	"extract",
	"parse",
	"generate",
	"transform",
	"route",
	"authenticate",
	"authorize",
	"cache",
	"query",
	"index",
	"serialize",
	"deserialize",
	"compress",
	"fold",
	"shard",
	"send",
	"receive",
	"fetch",
	"load",
	"save",
	"read",
	"write",
	"execute",
	"run",
	"start",
	"stop",
	"enable",
	"disable",
	"add",
	"remove",
	"check",
];

const ENTITY_PATTERNS: Array<{ type: string; pattern: RegExp }> = [
	{ type: "function", pattern: /(?:function|fn|def|const|let|var)\s+(\w+)/g },
	{ type: "class", pattern: /(?:class|interface|type|struct)\s+(\w+)/g },
	{
		type: "file_path",
		pattern: /(?:[\w./-]{1,120}\.(?:ts|tsx|js|jsx|py|go|rs|md|json|yaml|yml|toml))/g,
	},
	{ type: "url", pattern: /https?:\/\/[^\s,)]+/g },
	{
		type: "api_endpoint",
		pattern: /(?:GET|POST|PUT|DELETE|PATCH)\s+\/[\w/:-]+/g,
	},
	{
		type: "model_name",
		pattern:
			/(?:gpt-4(?:\.\d)?|gpt-5(?:\.\d)?|claude-(?:3\.\d|4\.\d)|gemini-(?:\d\.\d)|o[13]|llama|mistral|deepseek)/gi,
	},
	{
		type: "number",
		pattern: /\b\d+(?:\.\d+)?(?:%|ms|s|tok|tokens|usd|\$)\b/gi,
	},
	{ type: "code_ref", pattern: /`[^`]+`/g },
	{ type: "hex_color", pattern: /#(?:[0-9a-fA-F]{3}){1,2}\b/g },
	{
		type: "css_value",
		pattern: /(?:rgb|rgba|hsl|hsla)\s*\([^)]+\)/g,
	},
	{
		type: "config_number",
		pattern:
			/(?:timeout|max|min|port|size|limit|threshold|interval|delay|retries|workers|threads)\s*[:=]\s*\d+(?:\.\d+)?/gi,
	},
];

function extractEntities(text: string): string[] {
	const entities = new Set<string>();
	for (const { pattern } of ENTITY_PATTERNS) {
		const regex = new RegExp(pattern.source, pattern.flags);
		let match = regex.exec(text);
		while (match !== null) {
			entities.add(match[0]);
			match = regex.exec(text);
		}
	}
	return [...entities];
}

/**
 * Surface forms → base verb ("deploying", "deployed", "deploys" → "deploy").
 * Matching whole words replaces the old `text.includes(verb)` test, which
 * reported "add" for "address" and "run" for "truncate".
 */
const VERB_FORMS = new Map<string, string>();
for (const verb of ACTION_VERBS) {
	const last = verb[verb.length - 1] as string;
	const stem = verb.endsWith("e") ? verb.slice(0, -1) : verb;
	for (const form of [
		verb,
		`${verb}s`,
		`${verb}es`,
		`${verb}d`,
		`${verb}ed`,
		`${verb}ing`,
		`${verb}ment`,
		`${verb}er`,
		`${stem}ing`,
		`${verb}${last}ing`,
		`${verb}${last}ed`,
	]) {
		if (!VERB_FORMS.has(form)) VERB_FORMS.set(form, verb);
	}
}

function extractActions(text: string): string[] {
	const found = new Set<string>();
	for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
		const verb = VERB_FORMS.get(w);
		if (verb) found.add(verb);
	}
	// Stable, list-ordered output (callers show the first few).
	return ACTION_VERBS.filter((v) => found.has(v));
}

// ─── Helpers: hashing ────────────────────────────────────────────────────────

/**
 * FNV-1a 32-bit hash. Used to build compact fold-cache keys instead of using
 * the raw (potentially huge) text as a Map key. Deterministic and fast.
 */
function fnv1aHash(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		// FNV prime multiplication, keep it 32-bit.
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
}

// ─── Sentence selection ──────────────────────────────────────────────────────

interface ScoredSentence {
	text: string;
	score: number;
	hasCode: boolean;
	position: number;
}

function splitSentences(text: string): string[] {
	return text
		.split(/(?<=[.!?;])\s+|\n+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/**
 * Score every sentence. Higher = more worth keeping.
 *
 * The old score counted action-verb substrings and gave every sentence the
 * same flat +0.1, so it ranked by accident and ignored the question entirely.
 * This one asks what a sentence is *for*:
 *
 *   information  how many rare (within this text) terms it carries
 *   salience     digits, ids, code spans: the actual facts
 *   query        BM25 against the question, plus exact identifier hits
 *   filler       pleasantries and acknowledgements are pushed down hard
 *
 * With a query the question dominates; without one, information leads and the
 * opening sentence (usually the framing) gets a nudge.
 */
function scoreSentences(sentences: string[], docs: Doc[], query: string): number[] {
	const n = sentences.length;
	const index = new Bm25(docs);

	const info = docs.map((d) => {
		let sum = 0;
		for (const t of d.tf.keys()) sum += index.idf(t);
		return d.tf.size ? sum / Math.sqrt(d.tf.size) : 0;
	});
	const maxInfo = Math.max(...info, 1e-9);

	const qTerms = [...new Set(termsOf(query))];
	const qIds = identifiers(query);
	const bm = qTerms.length ? docs.map((_, i) => index.score(qTerms, i)) : [];
	const maxBm = bm.length ? Math.max(...bm) : 0;

	return sentences.map((sentence, i) => {
		const d = docs[i] as Doc;
		let score = 0.6 * ((info[i] as number) / maxInfo);

		score += Math.min(0.45, 0.15 * d.salient.size);
		if (/`[^`]+`/.test(sentence)) score += 0.15;
		if (sentence.split(/\s+/).length <= 15) score += 0.05;

		if (maxBm > 0) {
			score += 0.9 * ((bm[i] as number) / maxBm);
			const lower = sentence.toLowerCase();
			for (const id of qIds) if (lower.includes(id)) score += 0.8;
		} else if (i === 0 && n > 1) {
			score += 0.25;
		}

		if (d.fillerRatio >= 0.25) score *= 0.35;
		return score;
	});
}

function compressSentence(sentence: string): string {
	let compressed = sentence;

	// Remove filler words & hedging phrases. The lookarounds keep hyphenated
	// compounds intact ("just-in-time" must not become "-in-time").
	compressed = compressed.replace(
		/(?<![\w-])(?:basically|actually|essentially|really|very|quite|just|perhaps|maybe|kind of|sort of|I think|I believe|I feel|it seems|it appears|in order to|due to the fact that|for the purpose of|needless to say|as a matter of fact|at the end of the day|in terms of|when it comes to|the fact that|a number of|a lot of|lots of|in my opinion|from my perspective|going forward|at this point in time|at the present time|in the event that)(?![\w-])/gi,
		"",
	);

	// Collapse redundant phrases → terse equivalents (each is a real token win).
	compressed = compressed
		.replace(/\b(?:in order to|so as to)\b/gi, "to")
		.replace(/\b(?:due to the fact that|owing to the fact that)\b/gi, "because")
		.replace(/\b(?:for the purpose of)\b/gi, "for")
		.replace(/\b(?:a number of)\b/gi, "several")
		.replace(/\b(?:in the event that)\b/gi, "if")
		.replace(/\b(?:in spite of the fact that)\b/gi, "although")
		.replace(/\b(?:with regard to|with respect to|in reference to)\b/gi, "regarding")
		.replace(/\b(?:make a decision)\b/gi, "decide")
		.replace(/\b(?:come to a conclusion)\b/gi, "conclude")
		.replace(/\b(?:is able to)\b/gi, "can")
		.replace(/\b(?:in the near future)\b/gi, "soon");

	// Contractions are deliberately NOT applied: "do not" → "don't" measures as
	// 2 → 3 tokens, so the old rewrite made every such sentence more expensive.

	// Collapse whitespace
	compressed = compressed.replace(/\s+/g, " ").trim();

	// Remove trailing punctuation except important ones
	compressed = compressed.replace(/[,;]\s*$/, ".");

	return compressed;
}

// ─── Headline Builder ────────────────────────────────────────────────────────

function buildHeadline(actions: string[], entities: string[]): string {
	const actionPart =
		actions.length > 0 ? `[ACTION:${actions.slice(0, 3).join(",")}]` : "";

	const entityPart =
		entities.length > 0 ? `[TARGET:${entities.slice(0, 5).join(",")}]` : "";

	const parts = [actionPart, entityPart].filter(Boolean);
	return parts.join("");
}

/** Longest question text analysed when steering a fold or a shard. */
const MAX_QUERY_CHARS = 2000;

// ─── Main Folding Function ───────────────────────────────────────────────────

// LRU cache for fold results. Folding is called on every chat turn, and
// system prompts, tool schemas, and repeated messages often fold to
// identical results. Caching eliminates redundant work and cuts the
// per-turn cost when the same content is folded repeatedly.
const FOLD_CACHE_MAX_ENTRIES = 256;
const FOLD_CACHE_TTL_MS = 60_000; // 60 seconds
const foldCache = new Map<string, { result: FoldingResult; expiresAt: number }>();

function getCachedFold(key: string): FoldingResult | null {
  const entry = foldCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    foldCache.delete(key);
    return null;
  }
  // Move to end (most recently used).
  foldCache.delete(key);
  foldCache.set(key, entry);
  return entry.result;
}

function setCachedFold(key: string, result: FoldingResult): void {
  if (foldCache.size >= FOLD_CACHE_MAX_ENTRIES) {
    const oldest = foldCache.keys().next().value;
    if (oldest) foldCache.delete(oldest);
  }
  foldCache.set(key, { result, expiresAt: Date.now() + FOLD_CACHE_TTL_MS });
}

/** Clear the fold result cache. Useful for tests and forced re-folding. */
export function clearFoldCache(): void {
  foldCache.clear();
}

/** Current size of the fold result cache. Useful for monitoring. */
export function foldCacheSize(): number {
  return foldCache.size;
}

export function foldText(
	text: string,
	options: { maxTokens?: number; preserveCode?: boolean; query?: string } = {},
): FoldingResult {
	// Only the tail of a long question matters (a paste's question is its last
	// lines), and bounding it keeps the per-call cost independent of paste size.
	const query = (options.query ?? "").slice(-MAX_QUERY_CHARS);
	// Cache key: options + a compact hash of the text (and of the question,
	// which now steers selection). The length guards the 32-bit hash against
	// colliding two different texts of different sizes.
	const cacheKey = `${options.maxTokens ?? 2000}|${options.preserveCode ? "1" : "0"}|${text.length}:${fnv1aHash(text)}|${query ? fnv1aHash(query) : ""}`;
	const cached = getCachedFold(cacheKey);
	if (cached) return cached;

	const start = performance.now();
	const { maxTokens = 2000, preserveCode = true } = options;

	const originalTokens = estimateTokens(text);

	// Extract entities and actions
	const entities = extractEntities(text);
	const actions = extractActions(text);

	// Split into sentences, tokenize each ONCE, and drop near-duplicates through
	// the inverted index. Duplicates must also agree on every number/id, so two
	// sentences that differ only in a port or a version both survive.
	const all = splitSentences(text);
	const dup = new DupIndex(0.85);
	const sentences: string[] = [];
	const docs: Doc[] = [];
	const positions: number[] = [];
	all.forEach((sentence, position) => {
		const doc = makeDoc(sentence);
		if (dup.isDup(doc)) return;
		dup.add(doc);
		sentences.push(sentence);
		docs.push(doc);
		positions.push(position);
	});

	const scores = scoreSentences(sentences, docs, query);
	const scored: ScoredSentence[] = sentences.map((s, i) => ({
		text: s,
		score: scores[i] as number,
		hasCode: /`[^`]+`/.test(s) || /```[\s\S]*?```/.test(s),
		position: positions[i] as number,
	}));

	// Without a question, code-bearing sentences keep their old absolute
	// priority. With one, the question decides: a code span that has nothing to
	// do with it should not outrank the sentence that answers it.
	const codeFirst = preserveCode && !query;
	const sorted = [...scored].sort((a, b) => {
		if (codeFirst && a.hasCode && !b.hasCode) return -1;
		if (codeFirst && !a.hasCode && b.hasCode) return 1;
		return b.score - a.score;
	});

	// Keep top sentences until we hit the token budget
	let tokenBudget = maxTokens;
	const kept: ScoredSentence[] = [];

	for (const item of sorted) {
		const compressed = compressSentence(item.text);
		const tokens = estimateTokens(compressed);
		if (tokens <= tokenBudget) {
			kept.push({ ...item, text: compressed });
			tokenBudget -= tokens;
		}
		// Nothing shorter than a few tokens is worth a sentence slot.
		if (tokenBudget < 3) break;
	}

	// Restore original narrative order so the folded text reads coherently.
	kept.sort((a, b) => a.position - b.position);

	// Build the headline. It exists to carry what the body lost, so list only
	// entities that no kept sentence already contains (the old headline repeated
	// the first five entities of the input, kept or not). Adaptive as before:
	// skipped when the fold is not actually compressing.
	const body = kept.map((k) => k.text).join(" ");
	const lost = entities.filter((e) => !body.includes(e));
	const headline = buildHeadline(actions, lost);
	const bodyTokens = estimateTokens(body);
	const useHeadline =
		headline.length > 0 &&
		originalTokens > 0 &&
		bodyTokens < originalTokens * 0.9;
	const foldedPrompt = useHeadline ? `${headline}\n${body}` : body;

	const foldedTokens = estimateTokens(foldedPrompt);
	const compressionRatio =
		originalTokens > 0 ? foldedTokens / originalTokens : 1;
	const semanticDensity =
		entities.length > 0
			? Math.min(
					1,
					(actions.length + entities.length) / Math.max(foldedTokens / 10, 1),
				)
			: 0;

	const metadata: EntityHeadline = {
		headline: useHeadline ? headline : "",
		originalTokens,
		foldedTokens,
		compressionRatio,
		semanticDensity,
		entities: entities.slice(0, 10),
		actions: actions.slice(0, 5),
	};

	const result = {
		foldedPrompt,
		foldedTokens,
		metadata,
		estimatedSavingsUsd: 0, // Calculated at orchestrator level with pricing
		foldingTimeMs: performance.now() - start,
	};
	setCachedFold(cacheKey, result);
	return result;
}

// ─── Fold Messages ───────────────────────────────────────────────────────────

export function foldMessages(
	messages: ChatMessage[],
	options: {
		maxTokens?: number;
		preserveSystem?: boolean;
		/**
		 * Leave the most recent user turn verbatim. That turn is the question the
		 * model has to answer; folding it can blank or mangle the very thing the
		 * rest of the prompt exists to support. Pipelines should set this.
		 */
		preserveLastUser?: boolean;
		/**
		 * What the model has to answer. Sentences are kept or dropped with this in
		 * mind. Defaults to the preserved final user turn when there is one.
		 */
		query?: string;
	} = {},
): {
	messages: ChatMessage[];
	metadata: EntityHeadline;
	foldedTokens: number;
	foldingTimeMs: number;
} {
	const { maxTokens = 4000, preserveSystem = true, preserveLastUser = false } = options;
	const start = performance.now();

	let lastUserIdx = -1;
	if (preserveLastUser) {
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i]?.role === "user") {
				lastUserIdx = i;
				break;
			}
		}
	}
	// The preserved final turn IS the question; steer every other fold with it.
	// Capped to its tail: a long paste's question is its last lines.
	const query =
		options.query ??
		(lastUserIdx >= 0 ? (messages[lastUserIdx] as ChatMessage).content.slice(-600) : "");

	const result: ChatMessage[] = [];
	let totalOriginalTokens = 0;
	let totalFoldedTokens = 0;
	const allEntities: string[] = [];
	const allActions: string[] = [];

	for (const [idx, msg] of messages.entries()) {
		if (msg.role === "system" && preserveSystem) {
			result.push(msg);
			continue;
		}

		if (idx === lastUserIdx) {
			const tokens = estimateTokens(msg.content);
			totalOriginalTokens += tokens;
			totalFoldedTokens += tokens;
			result.push(msg);
			continue;
		}

		if (msg.role !== "user" && msg.role !== "assistant") {
			result.push(msg);
			continue;
		}

		const originalTokens = estimateTokens(msg.content);
		totalOriginalTokens += originalTokens;

		// Leave genuinely tiny turns untouched (don't bother folding a
		// one-liner). Gate on character length, not token count, so a
		// moderately long single message (hundreds of tokens) still gets
		// folded instead of being returned verbatim.
		if (msg.content.length <= 80) {
			result.push(msg);
			totalFoldedTokens += originalTokens;
			continue;
		}

		// Adaptive fold ratio. Scale with semantic density, but always apply a
		// meaningful compression to long turns so foldMessages actually shrinks
		// them (the test contract requires a long user turn to come back
		// shorter). Cap the effective budget so even dense long content is
		// compressed rather than returned verbatim.
		const entities = extractEntities(msg.content);
		const actions = extractActions(msg.content);
		const density = Math.min(1, (entities.length + actions.length) / Math.max(originalTokens / 8, 1));
		// Map density [0,1] → ratio [0.3, 0.6], then clamp the absolute budget
		// so a 4000-token message still folds to <= ~1200 tokens.
		const foldRatio = 0.3 + density * 0.3;
		const maxTokensForMsg = Math.min(
			Math.floor(originalTokens * foldRatio),
			1200,
			maxTokens,
		);

		const foldResult = foldText(msg.content, {
			maxTokens: maxTokensForMsg,
			preserveCode: true,
			query,
		});

		// A fold must never erase a turn. If it comes back blank, the original
		// is the only faithful answer — keep it.
		if (!foldResult.foldedPrompt.trim()) {
			result.push(msg);
			totalFoldedTokens += originalTokens;
			continue;
		}

		result.push({ ...msg, content: foldResult.foldedPrompt });
		totalFoldedTokens += foldResult.metadata.foldedTokens;
		allEntities.push(...foldResult.metadata.entities);
		allActions.push(...foldResult.metadata.actions);
	}

	const headline = buildHeadline(
		[...new Set(allActions)].slice(0, 5),
		[...new Set(allEntities)].slice(0, 10),
	);

	return {
		messages: result,
		foldedTokens: totalFoldedTokens,
		metadata: {
			headline,
			originalTokens: totalOriginalTokens,
			foldedTokens: totalFoldedTokens,
			compressionRatio:
				totalOriginalTokens > 0 ? totalFoldedTokens / totalOriginalTokens : 1,
			semanticDensity: allEntities.length / Math.max(totalFoldedTokens / 10, 1),
			entities: [...new Set(allEntities)].slice(0, 10),
			actions: [...new Set(allActions)].slice(0, 5),
		},
		foldingTimeMs: performance.now() - start,
	};
}

// ─── Token Estimation ────────────────────────────────────────────────────────
//
// `estimateTokens` is imported from ./token-counter.ts (pluggable BPE
// approximation, overridable via setTokenizer()). It is re-exported here for
// backward compatibility: the bench script and examples import it from this
// module. Prefer importing from ./token-counter.ts directly in new code.

export { estimateTokens } from "./token-counter.ts";

export default { foldText, foldMessages, estimateTokens };
