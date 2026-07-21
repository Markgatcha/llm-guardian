// OpenRouter Adapter — Unified API Connector
// Single adapter for routing to any OpenAI-compatible /chat/completions
// endpoint. Works against OpenRouter by default, and against local runtimes
// (LM Studio, Ollama, llama.cpp, vLLM, LocalAI) when configured with a
// local base URL and skipAuth — the wire format is identical.

import type {
	CompletionRequest,
	CompletionResponse,
	TokenUsage,
} from "../core/types.ts";

// ─── Configuration ───────────────────────────────────────────────────────────

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

let apiKey = process.env.OPENROUTER_API_KEY || "";
let baseUrl = OPENROUTER_BASE_URL;
// When true, no API key is required and the Authorization header is omitted.
// Used for local OpenAI-compatible runtimes (LM Studio, Ollama, llama.cpp).
let skipAuth = false;

// Default reasoning control for ALL calls via this adapter. Local reasoning
// models (e.g. Gemma 4 E2B on LM Studio) emit chain-of-thought by
// default, which is slow and non-deterministic; disable it for fast, stable
// local runs. Override per-call via CompletionRequest.reasoning.
// Env GUARDIAN_REASONING: "none"|"off" (default for local) | "low" |
// "medium" | "high" | "on". "on"/unset keeps the provider default.
type ReasoningSetting = { effort: "none" | "low" | "medium" | "high" } | false;
function parseReasoningEnv(): ReasoningSetting | undefined {
	const raw = (process.env.GUARDIAN_REASONING || "").toLowerCase();
	if (raw === "none" || raw === "off") return { effort: "none" };
	if (raw === "low") return { effort: "low" };
	if (raw === "medium") return { effort: "medium" };
	if (raw === "high") return { effort: "high" };
	if (raw === "on" || raw === "") return undefined;
	return undefined;
}
let defaultReasoning: ReasoningSetting | undefined = parseReasoningEnv();
// Base URLs that are treated as local runtimes and therefore don't need auth.
const LOCAL_HOST_RE =
	/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i;

export function configure(opts: {
	apiKey?: string;
	baseUrl?: string;
	skipAuth?: boolean;
	/** Default reasoning control for all calls (per-call overrides). */
	reasoning?: ReasoningSetting | false;
}): void {
	if (opts.apiKey !== undefined) apiKey = opts.apiKey;
	if (opts.baseUrl) baseUrl = opts.baseUrl;
	// Explicit override, or auto-detect a local base URL (no key needed).
	skipAuth = !!opts.skipAuth || LOCAL_HOST_RE.test(baseUrl);
	if (opts.reasoning !== undefined) defaultReasoning = opts.reasoning;
}

// ─── Retry Helper ────────────────────────────────────────────────────────────

async function fetchWithRetry(
	url: string,
	init: RequestInit,
	retries = MAX_RETRIES,
): Promise<Response> {
	let lastError: Error | undefined;
	for (let attempt = 0; attempt < retries; attempt++) {
		try {
			const response = await fetch(url, init);
			// Client errors (4xx) are not retryable — surface them so the
			// caller can format a meaningful error (e.g. "OpenRouter API error
			// 429"). Only 5xx and network failures are retried.
			if (response.ok || (response.status >= 400 && response.status < 500)) {
				return response;
			}
			// 5xx — retry
			lastError = new Error(`HTTP ${response.status}`);
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
		}
		const delay = BASE_DELAY_MS * 2 ** attempt;
		await new Promise((r) => setTimeout(r, delay));
	}
	throw lastError ?? new Error("fetchWithRetry: all retries exhausted");
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

	// Auto-select the cheapest capable model. Exclude local-runtime stubs
	// (modelName starts with "local/") — `router:auto` routes to a real remote
	// model, never the zero-cost local placeholder.
	const candidates = Array.from(getModelFingerprints().values()).filter(
		(fp) => {
			if (fp.modelName.startsWith("local/")) return false;
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
	if (!apiKey && !skipAuth) {
		throw new Error(
			"OpenRouter API key not configured. Set OPENROUTER_API_KEY, call configure({ apiKey }), or use a local runtime via configure({ skipAuth: true, baseUrl }).",
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
	// Reasoning control: per-call overrides the adapter default.
	const reasoning = request.reasoning ?? defaultReasoning;
	if (reasoning) body.reasoning = reasoning;

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...(skipAuth ? {} : { Authorization: `Bearer ${apiKey}` }),
		"HTTP-Referer": "https://llm-guardian.dev",
		"X-Title": "LLM Guardian",
	};
	// Token-efficient tools beta: compacts tool definitions/outputs for
	// 14-70% output-token savings when the catalog is large.
	if (request.tokenEfficientTools) {
		headers["anthropic-beta"] = "token-efficient-tools-2025";
	}

	const response = await fetchWithRetry(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers,
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
	if (!apiKey && !skipAuth) {
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
	const reasoning = request.reasoning ?? defaultReasoning;
	if (reasoning) body.reasoning = reasoning;

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...(skipAuth ? {} : { Authorization: `Bearer ${apiKey}` }),
		"HTTP-Referer": "https://llm-guardian.dev",
		"X-Title": "LLM Guardian",
	};
	// Token-efficient tools beta: compacts tool definitions/outputs for
	// 14-70% output-token savings when the catalog is large.
	if (request.tokenEfficientTools) {
		headers["anthropic-beta"] = "token-efficient-tools-2025";
	}

	const response = await fetchWithRetry(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers,
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
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		// Append chunk to buffer — handles split SSE frames across chunks
		buffer += decoder.decode(value, { stream: true });

		// Process complete SSE lines from buffer
		let newlineIdx = buffer.indexOf("\n");
		while (newlineIdx !== -1) {
			const line = buffer.slice(0, newlineIdx).trim();
			buffer = buffer.slice(newlineIdx + 1);

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
			newlineIdx = buffer.indexOf("\n");
		}
	}

	// Flush any remaining buffered content
	if (buffer.trim()) {
		for (const line of buffer.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed.startsWith("data: ")) continue;
			const data = trimmed.slice(6).trim();
			if (data === "[DONE]") continue;
			try {
				const parsed = JSON.parse(data);
				const content = parsed.choices?.[0]?.delta?.content || "";
				if (content) {
					fullContent += content;
					yield content;
				}
			} catch {
				// Skip malformed
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
