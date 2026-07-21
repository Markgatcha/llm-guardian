// Retain Pre-Filter — Hermes-style signal gate
//
// Inspired by NousResearch/hermes-agent issue #16834: an LLM-based (or cheap
// local) gate that decides, per turn, whether the content is worth retaining
// before it is written to the request log / future context. Without this, every
// completed turn (including low-signal acknowledgements, retries, and chit-chat)
// floods long-term state with noise, which (a) bloats future-context tokens and
// (b) makes retrieval / audit logs harder to scan.
//
// Default mode is a ZERO-LLM-CALL local classifier (keeps Guardian's sub-30ms
// guarantee): it scores a turn on signal density — entity count, action-verb
// presence, novelty vs already-seen entities, and a length floor. An optional
// LLM-backed mode can be injected via `setRetainClassifier()` for higher
// precision at the cost of latency.

import { estimateTokens } from "./token-counter.ts";

/**
 * Inputs the retain gate uses to make its decision.
 */
export interface RetainInput {
	/** The assistant's response content for this turn. */
	content: string;
	/** The user prompt that triggered the turn (for context). */
	userPrompt?: string;
	/**
	 * Role of the turn. USER and SYSTEM turns are always retained (the
	 * query and system instructions are sacred); the retain filter only
	 * prunes assistant / low-signal turns. Omitting role defaults to
	 * treating the turn as prunable.
	 */
	role?: "user" | "assistant" | "system" | "tool";
	/**
	 * Entities already seen earlier in the session (from the VCM skeleton).
	 * Used to down-weight turns that only repeat known entities (low novelty).
	 */
	seenEntities?: string[];
	/**
	 * Entities carried by turns we have ALREADY DECIDED TO RETAIN this
	 * pass. When provided, a turn that is the SOLE carrier of a
	 * high-value entity (file path, URL, API endpoint, or metric) is forced
	 * KEEP so the pipeline never silently drops the only mention of a fact.
	 * This is the "without losing context" guarantee for the retain filter.
	 */
	retainedEntities?: string[];
	/** Number of prior turns in the session (recency / novelty context). */
	turnIndex?: number;
}

/** The gate's verdict plus the score that drove it. */
export interface RetainDecision {
	/** True = keep full content in the log / future context. */
	retain: boolean;
	/** Signal-density score in [0, 1]. Higher = more worth retaining. */
	score: number;
	/** Human-readable reason for the decision (for debugging / dashboards). */
	reason: string;
}

/** Minimum content length (in chars) to even consider retaining. */
const MIN_LENGTH = 40;
/** Minimum token count to consider retaining. */
const MIN_TOKENS = 12;
/** Score at or above which a turn is retained. */
const RETAIN_THRESHOLD = 0.35;

// Signal indicators — presence of these pushes the score up.
const ACTION_VERBS =
	/\b(?:create|delete|update|refactor|build|fix|deploy|configure|analyze|optimize|implement|design|review|test|debug|migrate|integrate|validate|extract|parse|generate|transform|route|authenticate|authorize|cache|query|index|serialize|compress|fold|shard|send|fetch|load|save|read|write|execute|run|start|stop|enable|disable|add|remove|check|decide|conclude|approve|reject|warn|error|fail)\b/gi;

const ENTITY_SIGNALS = [
	/`[^`]+`/g, // code refs
	/(?:[\w./-]+\.(?:ts|tsx|js|jsx|py|go|rs|md|json|yaml|yml|toml))/g, // file paths
	/https?:\/\/[^\s,)]+/g, // urls
	/(?:GET|POST|PUT|DELETE|PATCH)\s+\/[\w/:-]+/g, // api endpoints
	/(?:gpt-4(?:\.\d)?|gpt-5(?:\.\d)?|claude-(?:3\.\d|4\.\d)|gemini-(?:\d\.\d)|o[13]|llama|mistral|deepseek)/gi, // model names
	/\b\d+(?:\.\d+)?(?:%|ms|s|tok|tokens|usd|\$)\b/gi, // metrics w/ units
];

// Low-signal indicators — presence pushes the score down (likely chit-chat /
// acknowledgement turns that aren't worth retaining in full).
const LOW_SIGNAL_PATTERNS =
	/\b(?:ok|okay|sure|got it|understood|done|will do|sure thing|sounds good|great|perfect|thanks|thank you|yep|yup|no problem|of course|absolutely|right|correct|exactly|sounds great|makes sense)\b/i;

// Answer / actionable signal — presence means the turn CARRIES information
// worth keeping (a concrete instruction, value, path, or metric), so it must
// never be dropped by the retain pre-filter even if its verb density is low.
// Without this, short fact-dense answers ("Rollback: npm dist-tag @latest
// prev and redeploy the Docker image") score below RETAIN_THRESHOLD and get
// deleted — silently losing the answer. See scripts/bench-context-loss.ts.
const ANSWER_SIGNAL_PATTERNS = [
	/`[^`]+`/g, // inline code / commands
	/(?:[\w./-]+\.(?:ts|tsx|js|jsx|py|go|rs|md|json|yaml|yml|toml))/g, // file paths
	/https?:\/\/[^\s,)]+/g, // urls
	/(?:GET|POST|PUT|DELETE|PATCH)\s+[\w/:-]+/g, // api endpoints
	/\b\d+(?:\.\d+)?(?:%|ms|s|tok|tokens|usd|\$)\b/gi, // metrics w/ units
	/\b(?:rollback|redeploy|revert|set|configure|update|add|remove|create|delete|enable|disable|restart|scale|migrate|install|run|execute|fix|patch|increase|decrease|change)\b/gi, // explicit step verbs
];

// Global regex instance for the low-signal check. Defined before scoreRetain
// uses it.
const LOW_SIGNAL_PATTERN_GLOBAL = new RegExp(LOW_SIGNAL_PATTERNS.source, "i");

/** True when `content` carries an answer/action signal we must never drop. */
export function hasAnswerSignal(content: string): boolean {
	for (const pattern of ANSWER_SIGNAL_PATTERNS) {
		const regex = new RegExp(pattern.source, pattern.flags);
		if (regex.test(content)) return true;
	}
	return false;
}

/**
 * Extract high-value entities (file paths, URLs, API endpoints, metrics) from
 * `content`. Used by callers to track which facts their retained turns
 * already cover, so the sole-carrier rescue in `isSoleCarrier` can keep a
 * turn that is the only mention of a fact.
 */
export function extractEntities(content: string): string[] {
	const out: string[] = [];
	for (const pattern of ENTITY_SIGNALS) {
		const regex = new RegExp(pattern.source, pattern.flags);
		const matches = content.match(regex);
		if (matches) out.push(...matches);
	}
	return out;
}

/**
 * Count distinct signal indicators in the content.
 */
function countSignals(content: string): number {
	let count = 0;
	for (const pattern of ENTITY_SIGNALS) {
		const regex = new RegExp(pattern.source, pattern.flags);
		const matches = content.match(regex);
		if (matches) count += new Set(matches).size;
	}
	return count;
}

/**
 * Default local classifier: scores a turn on signal density (0-1).
 *
 * Components:
 *  - Length floor: tiny responses score ~0.
 *  - Signal density: entities + action verbs + numbers per 100 tokens.
 *  - Novelty: down-weight turns whose entities were all already seen.
 *  - Low-signal penalty: pure acknowledgements score ~0.
 *
 * No LLM call, no I/O — runs in well under 1ms.
 */
export function scoreRetain(input: RetainInput): number {
	const { content, seenEntities = [] } = input;

	if (!content || content.length < MIN_LENGTH) return 0;

	const tokens = estimateTokens(content);
	if (tokens < MIN_TOKENS) return 0;

	// Hard penalty for pure acknowledgement turns.
	if (LOW_SIGNAL_PATTERN_GLOBAL.test(content.trim())) {
		LOW_SIGNAL_PATTERN_GLOBAL.lastIndex = 0;
		return 0.05;
	}
	LOW_SIGNAL_PATTERN_GLOBAL.lastIndex = 0;

	let score = 0;

	// Signal density: count distinct entities / code refs / metrics.
	const signalCount = countSignals(content);
	const density = Math.min(1, signalCount / 5); // 5+ signals → max density
	score += density * 0.45;

	// Action verbs: turns that describe or request an action are higher-value.
	const verbMatches = content.match(ACTION_VERBS) ?? [];
	const verbDensity = Math.min(1, new Set(verbMatches.map((v) => v.toLowerCase())).size / 3);
	score += verbDensity * 0.25;

	// Length appropriateness: reward substantive (but not bloated) responses.
	const lengthScore =
		tokens >= 25 && tokens <= 400 ? 0.15 : tokens > 400 ? 0.08 : 0.05;
	score += lengthScore;

	// Novelty: down-weight if all entities were already seen this session.
	if (seenEntities.length > 0 && signalCount > 0) {
		const seenLower = new Set(seenEntities.map((e) => e.toLowerCase()));
		const contentEntities = ENTITY_SIGNALS.flatMap((p) => {
			const r = new RegExp(p.source, p.flags);
			return content.match(r) ?? [];
		});
		const novel =
			contentEntities.filter((e) => !seenLower.has(e.toLowerCase())).length /
			Math.max(contentEntities.length, 1);
		score += novel * 0.15;
	} else {
		// No seen-entities context → assume novel.
		score += 0.15;
	}

	return Math.min(1, score);
}

/**
 * Decide whether to retain a turn's full content. Default uses the local
 * classifier; callers can inject an LLM-backed classifier via
 * `setRetainClassifier()` for higher precision.
 */
export function shouldRetain(input: RetainInput): RetainDecision {
	// Sacred turns: user query + system instructions are never pruned.
	if (input.role === "user" || input.role === "system") {
		return { retain: true, score: 1, reason: "sacred role" };
	}
	const score = scoreRetain(input);
	const answerSignal = hasAnswerSignal(input.content);
	const lowSignal = LOW_SIGNAL_PATTERN_GLOBAL.test(input.content.trim());
	LOW_SIGNAL_PATTERN_GLOBAL.lastIndex = 0;
	const soleCarrier = isSoleCarrier(input);
	// An acknowledgement phrase is low-signal → it must NOT be retained (dropped
	// from history), but the reason should still say "low-signal acknowledgement".
	// A sole carrier of a unique entity is rescued even if it also looks like an
	// answer.
	const retain = answerSignal || soleCarrier || score >= RETAIN_THRESHOLD;
	let reason: string;
	if (lowSignal) reason = "low-signal acknowledgement";
	else if (input.content.length < MIN_LENGTH) reason = "too short";
	else if (soleCarrier) reason = "sole carrier of unique signal";
	else if (answerSignal) reason = "answer/action signal";
	else if (score < 0.1) reason = "low-signal acknowledgement";
	else if (retain) reason = "signal density above threshold";
	else reason = "below retain threshold";
	const forced = reason === "sole carrier of unique signal";
	return { retain: retain || forced, score, reason };
}

/**
 * True when `content` carries a high-value entity that NO already-retained
 * turn has mentioned — i.e. dropping this turn loses the only mention of
 * that fact this pass.
 */
function isSoleCarrier(input: RetainInput): boolean {
	const retained = input.retainedEntities ?? [];
	const UNIQUE_PATTERNS = [
		/(?:[\w./-]+\.(?:ts|tsx|js|jsx|py|go|rs|md|json|yaml|yml|toml))/g,
		/https?:\/\/[^\s,)]+/g,
		/(?:GET|POST|PUT|DELETE|PATCH)\s+[\w/:-]+/g,
		/\b\d+(?:\.\d+)?(?:%|ms|s|tok|tokens|usd|\$)\b/gi,
	];
	for (const pattern of UNIQUE_PATTERNS) {
		const regex = new RegExp(pattern.source, pattern.flags);
		const matches = input.content.match(regex);
		if (matches) {
			// Nothing retained yet → any high-value entity is the sole carrier.
			if (retained.length === 0) return true;
			const unseen = matches.filter((m) => !retained.includes(m));
			if (unseen.length > 0) return true;
		}
	}
	return false;
}

/**
 * Optional pluggable classifier. When set, `shouldRetain` delegates to it
 * instead of the local scorer. Useful for an LLM-backed mode (e.g. a cheap
 * model classifying "is this turn worth keeping?"). Pass undefined to restore
 * the default local classifier.
 *
 * @example
 *   setRetainClassifier(async (input) => {
 *     const verdict = await cheapModel.classify(input.content);
 *     return { retain: verdict.keep, score: verdict.confidence, reason: "llm" };
 *   });
 */
let customClassifier: ((input: RetainInput) => RetainDecision) | null = null;

export function setRetainClassifier(
	classifier?: (input: RetainInput) => RetainDecision,
): void {
	customClassifier = classifier ?? null;
}

/** Decide whether to retain, using the custom classifier if one is installed. */
export function decideRetain(input: RetainInput): RetainDecision {
	if (customClassifier) return customClassifier(input);
	return shouldRetain(input);
}

export { RETAIN_THRESHOLD };

export default { shouldRetain, decideRetain, scoreRetain };
