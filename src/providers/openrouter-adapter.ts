// OpenRouter Adapter — Unified API Connector
// Single adapter for routing to any model through OpenRouter

import type {
	CompletionRequest,
	CompletionResponse,
	TokenUsage,
} from "../core/types.ts";

// ─── Configuration ───────────────────────────────────────────────────────────

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

let apiKey = process.env.OPENROUTER_API_KEY || "";
let baseUrl = OPENROUTER_BASE_URL;

export function configure(opts: { apiKey?: string; baseUrl?: string }): void {
	if (opts.apiKey) apiKey = opts.apiKey;
	if (opts.baseUrl) baseUrl = opts.baseUrl;
}

// ─── Model Selection ─────────────────────────────────────────────────────────

const AUTO_MODELS = new Set(["auto", "smart", "router:auto"]);

export function selectModel(
	requestedModel: string,
	options: {
		maxTokens?: number;
		needsVision?: boolean;
		needsStreaming?: boolean;
	} = {},
): string {
	if (!AUTO_MODELS.has(requestedModel)) {
		return requestedModel;
	}

	// Auto-select the cheapest capable model
	const candidates = Array.from(getModelFingerprints().values()).filter(
		(fp) => {
			if (options.needsVision && !fp.supportsVision) return false;
			if (options.needsStreaming && !fp.supportsStreaming) return false;
			if (options.maxTokens && options.maxTokens > fp.maxOutputTokens)
				return false;
			return true;
		},
	);

	if (candidates.length === 0) {
		return "openai/gpt-4o-mini"; // Fallback
	}

	// Sort by cost, then by context window (prefer bigger context)
	candidates.sort((a, b) => {
		const costDiff = a.inputCostPerMillion - b.inputCostPerMillion;
		if (Math.abs(costDiff) > 0.01) return costDiff;
		return b.contextWindow - a.contextWindow;
	});

	return candidates[0].modelName;
}

function getModelFingerprints(): Map<
	string,
	import("../core/types.ts").ModelFingerprint
> {
	// Lazy import to avoid circular dependency
	const { getAllFingerprints } = require("./fingerprints.ts");
	const map = new Map<string, import("../core/types.ts").ModelFingerprint>();
	for (const fp of getAllFingerprints()) {
		map.set(fp.modelName.toLowerCase(), fp);
	}
	return map;
}

// ─── API Call ────────────────────────────────────────────────────────────────

export async function complete(
	request: CompletionRequest,
): Promise<CompletionResponse> {
	if (!apiKey) {
		throw new Error(
			"OpenRouter API key not configured. Set OPENROUTER_API_KEY or call configure()",
		);
	}

	const body: Record<string, unknown> = {
		model: request.model,
		messages: request.messages.map((m) => ({
			role: m.role,
			content: m.content,
			...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
			...(m.name ? { name: m.name } : {}),
		})),
	};

	if (request.temperature !== undefined) body.temperature = request.temperature;
	if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
	if (request.stream !== undefined) body.stream = request.stream;
	if (request.tools !== undefined) body.tools = request.tools;

	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
			"HTTP-Referer": "https://llm-guardian.dev",
			"X-Title": "LLM Guardian",
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const errorText = await response.text().catch(() => "Unknown error");
		throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
	}

	const data = (await response.json()) as Record<string, unknown>;

	const choices = (data.choices as Array<Record<string, unknown>>) || [];
	const firstChoice = choices[0] || {};
	const message = (firstChoice.message as Record<string, unknown>) || {};
	const usage = (data.usage as Record<string, number>) || {};

	const content = (message.content as string) || "";
	const toolCallsRaw =
		(message.tool_calls as Array<Record<string, unknown>>) || [];

	return {
		id: (data.id as string) || crypto.randomUUID(),
		model: (data.model as string) || request.model,
		content,
		toolCalls: toolCallsRaw.map((tc) => ({
			id: (tc.id as string) || "",
			type: "function" as const,
			function: {
				name: ((tc.function as Record<string, unknown>)?.name as string) || "",
				arguments:
					((tc.function as Record<string, unknown>)?.arguments as string) ||
					"{}",
			},
		})),
		usage: {
			promptTokens: (usage.prompt_tokens as number) || 0,
			completionTokens: (usage.completion_tokens as number) || 0,
			totalTokens: (usage.total_tokens as number) || 0,
		},
		finishReason: (firstChoice.finish_reason as string) || "stop",
	};
}

// ─── Streaming Completion ────────────────────────────────────────────────────

export async function* completeStream(
	request: CompletionRequest,
): AsyncGenerator<string, CompletionResponse> {
	if (!apiKey) {
		throw new Error("OpenRouter API key not configured.");
	}

	const body: Record<string, unknown> = {
		model: request.model,
		messages: request.messages.map((m) => ({
			role: m.role,
			content: m.content,
		})),
		stream: true,
	};

	if (request.temperature !== undefined) body.temperature = request.temperature;
	if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
	if (request.tools !== undefined) body.tools = request.tools;

	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
			"HTTP-Referer": "https://llm-guardian.dev",
			"X-Title": "LLM Guardian",
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const errorText = await response.text().catch(() => "Unknown error");
		throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
	}

	const reader = response.body?.getReader();
	if (!reader) throw new Error("No response body");

	const decoder = new TextDecoder();
	let fullContent = "";
	let usage: TokenUsage = {
		promptTokens: 0,
		completionTokens: 0,
		totalTokens: 0,
	};
	let model = request.model;

	const _buffer = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		const chunk = decoder.decode(value, { stream: true });
		const lines = chunk.split("\n");

		for (const line of lines) {
			if (!line.startsWith("data: ")) continue;
			const data = line.slice(6).trim();
			if (data === "[DONE]") continue;

			try {
				const parsed = JSON.parse(data);
				const choices = parsed.choices || [];
				const delta = choices[0]?.delta || {};
				const content = delta.content || "";

				if (content) {
					fullContent += content;
					yield content;
				}

				if (parsed.model) model = parsed.model;
				if (parsed.usage) {
					usage = {
						promptTokens: parsed.usage.prompt_tokens || 0,
						completionTokens: parsed.usage.completion_tokens || 0,
						totalTokens: parsed.usage.total_tokens || 0,
					};
				}
			} catch {
				// Skip malformed chunks
			}
		}
	}

	return {
		id: crypto.randomUUID(),
		model,
		content: fullContent,
		usage,
		finishReason: "stop",
	};
}

export default { configure, selectModel, complete, completeStream };
