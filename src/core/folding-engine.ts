// Semantic Folding Engine — EDH (Entity-Dense Headlinese) Distillation
// Converts raw text into compressed, high-density semantic representations
// Target: <50ms local execution

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
		pattern: /(?:[\w./-]+\.(?:ts|tsx|js|jsx|py|go|rs|md|json|yaml|yml|toml))/g,
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

function extractActions(text: string): string[] {
	const lower = text.toLowerCase();
	const found = new Set<string>();
	for (const verb of ACTION_VERBS) {
		if (lower.includes(verb)) {
			found.add(verb);
		}
	}
	return [...found];
}

// ─── Sentence Compression ────────────────────────────────────────────────────

function splitSentences(text: string): string[] {
	return text
		.split(/(?<=[.!?;])\s+|\n+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

function computeRelevanceScore(sentence: string): number {
	let score = 0;
	const lower = sentence.toLowerCase();

	// Sentences with action verbs are more relevant
	for (const verb of ACTION_VERBS) {
		if (lower.includes(verb)) score += 0.15;
	}

	// Sentences with code refs are more relevant
	if (/`[^`]+`/.test(sentence)) score += 0.2;

	// Sentences with numbers/metrics are more relevant
	if (/\d+/.test(sentence)) score += 0.1;

	// Shorter sentences tend to be more information-dense
	const words = sentence.split(/\s+/).length;
	if (words <= 15) score += 0.15;
	else if (words <= 30) score += 0.05;

	// Sentences at the start or end of a paragraph are more important
	score += 0.1;

	return Math.min(score, 1);
}

function compressSentence(sentence: string): string {
	let compressed = sentence;

	// Remove filler words
	compressed = compressed.replace(
		/\b(?:basically|actually|essentially|really|very|quite|just|perhaps|maybe|kind of|sort of|I think|I believe|it seems|in order to|due to the fact that|for the purpose of)\b/gi,
		"",
	);

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

// ─── Main Folding Function ───────────────────────────────────────────────────

export function foldText(
	text: string,
	options: { maxTokens?: number; preserveCode?: boolean } = {},
): FoldingResult {
	const start = performance.now();
	const { maxTokens = 2000, preserveCode = true } = options;

	const originalTokens = estimateTokens(text);

	// Extract entities and actions
	const entities = extractEntities(text);
	const actions = extractActions(text);

	// Split into sentences and score
	const sentences = splitSentences(text);
	const scored = sentences.map((s) => ({
		text: s,
		score: computeRelevanceScore(s),
		hasCode: /`[^`]+`/.test(s) || /```[\s\S]*?```/.test(s),
	}));

	// Sort by relevance, preserve code blocks if requested
	scored.sort((a, b) => {
		if (preserveCode && a.hasCode && !b.hasCode) return -1;
		if (preserveCode && !a.hasCode && b.hasCode) return 1;
		return b.score - a.score;
	});

	// Keep top sentences until we hit the token budget
	let tokenBudget = maxTokens;
	const kept: string[] = [];

	for (const item of scored) {
		const compressed = compressSentence(item.text);
		const tokens = estimateTokens(compressed);
		if (tokens <= tokenBudget) {
			kept.push(compressed);
			tokenBudget -= tokens;
		}
		if (tokenBudget <= 0) break;
	}

	// Build the folded prompt
	const headline = buildHeadline(actions, entities);
	const foldedPrompt = headline
		? `${headline}\n${kept.join(" ")}`
		: kept.join(" ");

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
		headline,
		originalTokens,
		foldedTokens,
		compressionRatio,
		semanticDensity,
		entities: entities.slice(0, 10),
		actions: actions.slice(0, 5),
	};

	return {
		foldedPrompt,
		metadata,
		estimatedSavingsUsd: 0, // Calculated at orchestrator level with pricing
		foldingTimeMs: performance.now() - start,
	};
}

// ─── Fold Messages ───────────────────────────────────────────────────────────

export function foldMessages(
	messages: ChatMessage[],
	options: { maxTokens?: number; preserveSystem?: boolean } = {},
): {
	messages: ChatMessage[];
	metadata: EntityHeadline;
	foldingTimeMs: number;
} {
	const { maxTokens = 4000, preserveSystem = true } = options;
	const start = performance.now();

	const result: ChatMessage[] = [];
	let totalOriginalTokens = 0;
	let totalFoldedTokens = 0;
	const allEntities: string[] = [];
	const allActions: string[] = [];

	for (const msg of messages) {
		if (msg.role === "system" && preserveSystem) {
			result.push(msg);
			continue;
		}

		if (msg.role !== "user" && msg.role !== "assistant") {
			result.push(msg);
			continue;
		}

		const originalTokens = estimateTokens(msg.content);
		totalOriginalTokens += originalTokens;

		if (originalTokens <= 500) {
			result.push(msg);
			totalFoldedTokens += originalTokens;
			continue;
		}

		const foldResult = foldText(msg.content, {
			maxTokens: Math.min(maxTokens, Math.floor(originalTokens * 0.4)),
			preserveCode: true,
		});

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

export function estimateTokens(text: string): number {
	if (!text) return 0;
	// ~4 chars per token for English, slightly more for code
	const hasCode = /[{}()[\];=]/.test(text);
	const divisor = hasCode ? 3.5 : 4;
	return Math.ceil(text.length / divisor);
}

export default { foldText, foldMessages, estimateTokens };
