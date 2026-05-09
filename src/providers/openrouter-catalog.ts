import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderModel } from "../tui/types.ts";

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
export const OPENROUTER_CATALOG_TTL_MS = 4 * 24 * 60 * 60 * 1000;

export interface OpenRouterCatalogCache {
	fetchedAt: string;
	sourceUrl: string;
	rawCount: number;
	models: ProviderModel[];
}

export interface OpenRouterCatalogResult {
	models: ProviderModel[];
	fetchedAt?: string;
	fromCache: boolean;
	stale: boolean;
	error?: string;
}

type Fetcher = typeof fetch;

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}
	return fallback;
}

function catalogCachePath(projectRoot: string): string {
	return join(projectRoot, ".guardian", "cache", "openrouter-models.json");
}

function readCache(projectRoot: string): OpenRouterCatalogCache | null {
	const path = catalogCachePath(projectRoot);
	if (!existsSync(path)) return null;
	try {
		const payload = JSON.parse(readFileSync(path, "utf8"));
		const record = asRecord(payload);
		const fetchedAt = asString(record.fetchedAt);
		const models = asArray(record.models).map((item) => {
			const model = asRecord(item);
			return {
				model: asString(model.model),
				provider: asString(model.provider),
				inputPerMillion: asNumber(model.inputPerMillion),
				outputPerMillion: asNumber(model.outputPerMillion),
				p95LatencyMs: asNumber(model.p95LatencyMs),
				contextWindow: asNumber(model.contextWindow, Number.NaN),
				maxCompletionTokens: asNumber(model.maxCompletionTokens, Number.NaN),
				source: "openrouter" as const,
				catalogUpdatedAt: fetchedAt,
				createdAt: asString(model.createdAt),
				supportsTools: Boolean(model.supportsTools),
				supportsVision: Boolean(model.supportsVision),
			};
		});
		if (!fetchedAt || models.length === 0) return null;
		return {
			fetchedAt,
			sourceUrl: asString(record.sourceUrl, OPENROUTER_MODELS_URL),
			rawCount: asNumber(record.rawCount, models.length),
			models,
		};
	} catch {
		return null;
	}
}

function writeCache(projectRoot: string, cache: OpenRouterCatalogCache): void {
	const path = catalogCachePath(projectRoot);
	mkdirSync(join(projectRoot, ".guardian", "cache"), { recursive: true });
	writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

function cacheAgeMs(cache: OpenRouterCatalogCache, now = Date.now()): number {
	const fetchedAt = Date.parse(cache.fetchedAt);
	return Number.isFinite(fetchedAt) ? now - fetchedAt : Number.POSITIVE_INFINITY;
}

function providerFromModelId(id: string): string {
	return id.includes("/") ? id.split("/", 1)[0] : "openrouter";
}

function normalizeOpenRouterModel(payload: unknown, fetchedAt: string): ProviderModel | null {
	const model = asRecord(payload);
	const id = asString(model.id);
	if (!id) return null;
	const pricing = asRecord(model.pricing);
	const architecture = asRecord(model.architecture);
	const topProvider = asRecord(model.top_provider);
	const supportedParameters = asArray(model.supported_parameters);
	const inputModalities = asArray(architecture.input_modalities);
	const created = asNumber(model.created, Number.NaN);
	return {
		model: id,
		provider: providerFromModelId(id),
		inputPerMillion: asNumber(pricing.prompt) * 1_000_000,
		outputPerMillion: asNumber(pricing.completion) * 1_000_000,
		p95LatencyMs: 0,
		contextWindow: asNumber(
			topProvider.context_length ?? model.context_length,
			Number.NaN,
		),
		maxCompletionTokens: asNumber(
			topProvider.max_completion_tokens,
			Number.NaN,
		),
		source: "openrouter",
		catalogUpdatedAt: fetchedAt,
		createdAt: Number.isFinite(created)
			? new Date(created * 1000).toISOString()
			: undefined,
		supportsTools:
			supportedParameters.includes("tools") ||
			supportedParameters.includes("tool_choice"),
		supportsVision: inputModalities.includes("image"),
	};
}

function sortModels(models: ProviderModel[]): ProviderModel[] {
	return [...models].sort((a, b) => {
		const createdA = a.createdAt ? Date.parse(a.createdAt) : 0;
		const createdB = b.createdAt ? Date.parse(b.createdAt) : 0;
		if (createdA !== createdB) return createdB - createdA;
		return a.model.localeCompare(b.model);
	});
}

export async function refreshOpenRouterCatalog(
	projectRoot: string,
	fetcher: Fetcher = fetch,
): Promise<OpenRouterCatalogResult> {
	try {
		const response = await fetcher(OPENROUTER_MODELS_URL);
		if (!response.ok) {
			throw new Error(`OpenRouter models returned HTTP ${response.status}`);
		}
		const payload = asRecord(await response.json());
		const fetchedAt = new Date().toISOString();
		const raw = asArray(payload.data);
		const models = sortModels(
			raw
				.map((item) => normalizeOpenRouterModel(item, fetchedAt))
				.filter((item): item is ProviderModel => item !== null),
		);
		const cache = {
			fetchedAt,
			sourceUrl: OPENROUTER_MODELS_URL,
			rawCount: raw.length,
			models,
		};
		writeCache(projectRoot, cache);
		return { models, fetchedAt, fromCache: false, stale: false };
	} catch (error) {
		const cached = readCache(projectRoot);
		if (cached) {
			return {
				models: cached.models,
				fetchedAt: cached.fetchedAt,
				fromCache: true,
				stale: true,
				error: error instanceof Error ? error.message : "OpenRouter refresh failed",
			};
		}
		return {
			models: [],
			fromCache: false,
			stale: true,
			error: error instanceof Error ? error.message : "OpenRouter refresh failed",
		};
	}
}

export async function loadOpenRouterCatalog(
	projectRoot: string,
	options: { maxAgeMs?: number; fetcher?: Fetcher; now?: number } = {},
): Promise<OpenRouterCatalogResult> {
	const maxAgeMs = options.maxAgeMs ?? OPENROUTER_CATALOG_TTL_MS;
	const cached = readCache(projectRoot);
	if (cached && cacheAgeMs(cached, options.now) <= maxAgeMs) {
		return {
			models: cached.models,
			fetchedAt: cached.fetchedAt,
			fromCache: true,
			stale: false,
		};
	}
	return refreshOpenRouterCatalog(projectRoot, options.fetcher ?? fetch);
}
