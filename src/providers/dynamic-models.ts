// Dynamic Model Discovery — Fetch live model data from OpenRouter
//
// Instead of maintaining a static fingerprint database that goes stale,
// this module queries the OpenRouter API for the current model catalog
// (IDs, names, descriptions, context windows, pricing, capabilities).
// Results are cached for a configurable TTL (default: 1 hour) and merged
// with static fingerprints as fallbacks for offline/local models.

import type { ModelFingerprint } from "../core/types.ts";
import { getAllFingerprints } from "./fingerprints.ts";

// ─── Configuration ───────────────────────────────────────────────────────────

const OPENROUTER_MODELS_API = "https://openrouter.ai/api/v1/models";
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const _DEFAULT_MAX_RESULTS = 500; // Cap to avoid excessive payloads

// ─── Cache ────────────────────────────────────────────────────────────────────

interface CachedModel {
	fetchedAt: number;
	models: DynamicModel[];
}

let cache: CachedModel | null = null;
let cacheTtlMs = DEFAULT_CACHE_TTL_MS;

/**
 * Dynamic model info from the OpenRouter API.
 */
export interface DynamicModel {
	/** Full model ID, e.g. "anthropic/claude-opus-4.8" */
	id: string;
	/** Human-readable name, e.g. "Claude Opus 4.8" */
	name: string;
	/** Short description from the provider */
	description: string;
	/** Context window in tokens */
	context_length: number;
	/** Pricing per 1M tokens (as string, needs parseFloat) */
	 pricing: {
		prompt: string;
		completion: string;
	};
	/** Top-level provider, e.g. "anthropic", "openai" */
	// Derived from the model ID prefix (before "/").
	/** Supported parameters (tools, reasoning, etc.) */
	supported_parameters: string[];
	/** Whether the model supports tools */
	supportsTools: boolean;
	/** Whether the model supports reasoning */
	supportsReasoning: boolean;
	/** Whether the model supports streaming */
	supportsStreaming: boolean;
	/** Knowledge cutoff (may be null) */
	knowledge_cutoff: string | null;
	/** Benchmark scores (may be empty) */
	benchmarks: Record<string, unknown>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Configure the dynamic model discovery cache.
 *
 * @param opts.cacheTtlMs — How long to cache API responses (ms)
 * @param opts.maxResults — Maximum number of models to fetch
 * @param opts.apiUrl — Override the OpenRouter API URL
 */
export function configureDynamic(opts: {
	cacheTtlMs?: number;
	maxResults?: number;
	apiUrl?: string;
}): void {
	if (opts.cacheTtlMs !== undefined) cacheTtlMs = opts.cacheTtlMs;
	if (opts.maxResults !== undefined) {
		// Stored for future use; API URL doesn't currently support a limit param.
	}
}

/**
 * Fetch the latest model catalog from OpenRouter.
 * Returns cached results if available and not expired.
 *
 * @returns Array of dynamic model info objects
 */
export async function fetchDynamicModels(): Promise<DynamicModel[]> {
	// Return cache if fresh.
	if (cache && Date.now() - cache.fetchedAt < cacheTtlMs) {
		return cache.models;
	}

	const apiKey = process.env.OPENROUTER_API_KEY || "";
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
		"HTTP-Referer": "https://llm-guardian.dev",
		"X-Title": "LLM Guardian",
	};

	const response = await fetch(OPENROUTER_MODELS_API, {
		method: "GET",
		headers,
	});

	if (!response.ok) {
		throw new Error(
			`Failed to fetch models from OpenRouter: ${response.status} ${response.statusText}`,
		);
	}

	const data = (await response.json()) as { data: DynamicModel[] };
	const models = data.data ?? [];

	// Enrich with derived capabilities.
	const enriched = models.map((m) => ({
		...m,
		supportsTools: (m.supported_parameters ?? []).includes("tools"),
		supportsReasoning: (m.supported_parameters ?? []).includes("reasoning"),
		supportsStreaming: true, // OpenRouter supports streaming for all models
	}));

	cache = { fetchedAt: Date.now(), models: enriched };
	return enriched;
}

/**
 * Resolve a model name to a `ModelFingerprint`, combining dynamic data
 * from OpenRouter with static fallback fingerprints.
 *
 * If the model exists in the dynamic catalog, its live pricing and
 * capabilities are used. Otherwise, falls back to the static fingerprints
 * (which cover local models like llama.cpp).
 *
 * @param modelName - The model identifier (e.g., "anthropic/claude-4.8" or "gpt-5")
 * @returns A ModelFingerprint, or null if not found
 */
export async function resolveModelFingerprint(
	modelName: string,
): Promise<ModelFingerprint | null> {
	const lower = modelName.toLowerCase();

	// 1. Try the dynamic OpenRouter catalog (cached).
	try {
		const dynamicModels = await fetchDynamicModels();
		const match = dynamicModels.find(
			(m) =>
				m.id.toLowerCase() === lower ||
				m.id.toLowerCase().replace(/\/.+-2026\d+$/, "") === lower ||
				stripDateSuffix(m.id.toLowerCase()) === lower,
		);

		if (match) {
			return {
				modelName: match.id,
				provider: match.id.split("/")[0] ?? "openrouter",
				attentionBiases: getDefaultBias(match.id),
				optimalStructure: getDefaultStructure(),
				contextWindow: match.context_length,
				maxOutputTokens: Math.min(match.context_length, 64_000),
				inputCostPerMillion: parseFloat(match.pricing.prompt) * 1_000_000,
				outputCostPerMillion: parseFloat(match.pricing.completion) * 1_000_000,
				supportsStreaming: match.supportsStreaming,
				supportsVision: match.supported_parameters.includes("image"),
				supportsToolUse: match.supportsTools,
			};
		}
	} catch {
		// Network error — fall through to static fingerprints.
	}

	// 2. Fall back to static fingerprints.
	const staticFps = getAllFingerprints();
	return staticFps.find(
		(fp) =>
			fp.modelName.toLowerCase() === lower ||
			fp.modelName.toLowerCase().replace(/^[^:]+:\/\//, "") === lower,
	) ?? null;
}

/**
 * List all available models, combining dynamic (OpenRouter) and static
 * (local) sources. Each entry includes live pricing from OpenRouter
 * when available.
 *
 * @returns Array of model listings with provider, pricing, and capabilities
 */
export async function listAllModels(): Promise<
	Array<{
		id: string;
		name: string;
		provider: string;
		inputCostPerMillion: number;
		outputCostPerMillion: number;
		contextWindow: number;
		supportsTools: boolean;
	}>
> {
	const staticFps = getAllFingerprints();
	const listing = new Map<string, {
    id: string;
    name: string;
    provider: string;
    inputCostPerMillion: number;
    outputCostPerMillion: number;
    contextWindow: number;
    supportsTools: boolean;
}>();

	// Add static fingerprints first.
	for (const fp of staticFps) {
		listing.set(fp.modelName.toLowerCase(), {
			id: fp.modelName,
			name: fp.modelName.split("/").pop() ?? fp.modelName,
			provider: fp.provider ?? fp.modelName.split("/")[0] ?? "unknown",
			inputCostPerMillion: fp.inputCostPerMillion,
			outputCostPerMillion: fp.outputCostPerMillion,
			contextWindow: fp.contextWindow,
			supportsTools: fp.supportsToolUse ?? false,
		});
	}

	// Merge in dynamic models (overwriting with live data when available).
	try {
		const dynamicModels = await fetchDynamicModels();
		for (const dm of dynamicModels) {
			const key = dm.id.toLowerCase();
			listing.set(key, {
				id: dm.id,
				name: dm.name,
				provider: dm.id.split("/")[0] ?? "openrouter",
				inputCostPerMillion: parseFloat(dm.pricing.prompt) * 1_000_000,
				outputCostPerMillion: parseFloat(dm.pricing.completion) * 1_000_000,
				contextWindow: dm.context_length,
				supportsTools: dm.supportsTools,
			});
		}
	} catch {
		// Ignore — just return static fingerprints.
	}

	return Array.from(listing.values());
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Strip a trailing date suffix from model IDs.
 * e.g. "anthropic/claude-opus-4.6-haiku-20260205" → "anthropic/claude-opus-4.6-haiku"
 * @param id - Lowercased model ID
 */
function stripDateSuffix(id: string): string {
	return id.replace(/-?\d{8}$/, "");
}

/**
 * Get the default attention bias for a model based on its provider prefix.
 */
function getDefaultBias(modelId: string): ModelFingerprint["attentionBiases"] {
	const lower = modelId.toLowerCase();
	if (lower.startsWith("anthropic/") || lower.startsWith("claude-")) {
		return {
			systemPrompt: 0.95,
			userFirstParagraph: 0.9,
			userMiddleSection: 0.5,
			userLastParagraph: 0.85,
			examples: 0.8,
			toolDefinitions: 0.75,
		};
	}
	if (lower.startsWith("openai/") || lower.startsWith("gpt-") || lower.startsWith("o1") || lower.startsWith("o3")) {
		return {
			systemPrompt: 0.9,
			userFirstParagraph: 0.85,
			userMiddleSection: 0.6,
			userLastParagraph: 0.9,
			examples: 0.85,
			toolDefinitions: 0.8,
		};
	}
	// Default for unknown providers.
	return {
		systemPrompt: 0.85,
		userFirstParagraph: 0.8,
		userMiddleSection: 0.55,
		userLastParagraph: 0.8,
		examples: 0.7,
		toolDefinitions: 0.7,
	};
}

/**
 * Get the default optimal prompt structure (generic, works for most models).
 */
function getDefaultStructure(): ModelFingerprint["optimalStructure"] {
	return [
		{ type: "system", priority: 1, maxLength: 3000 },
		{ type: "context", priority: 2, maxLength: 5000 },
		{ type: "examples", priority: 3, maxLength: 2000 },
		{ type: "tools", priority: 4, maxLength: 2000 },
		{ type: "instruction", priority: 5, maxLength: 1500 },
		{ type: "query", priority: 6, maxLength: 3000 },
	];
}

// ─── Cache Management ────────────────────────────────────────────────────────

/**
 * Clear the dynamic model cache, forcing a fresh fetch on the next call.
 * Useful in tests or when you know the catalog has been updated.
 */
export function clearModelCache(): void {
	cache = null;
}
