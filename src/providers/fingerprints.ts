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
	{ type: "context", priority: 3, maxLength: 6000 },
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
					? `${content.slice(0, section.maxLength)}...`
					: content;
			ordered.push(truncated);
		}
	}

	return ordered.join("\n\n");
}

export default {
	getModelFingerprint,
	getAllFingerprints,
	getCheapestModel,
	reorderPromptForModel,
};
