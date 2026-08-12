// Orchestrator — The Brain of LLM-Guardian
// Coordinates Semantic Folding, VCM Sharding, Tool Fusion,
// Privacy Shield, Budget Management, and Model Routing

import { checkBudget, recordSpend } from "../gateway/budget-manager.ts";
import { sanitizeText, scanPII } from "../gateway/privacy-shield.ts";
import { getModelFingerprint } from "../providers/fingerprints.ts";
import {
	complete,
	completeStream,
	selectModel,
} from "../providers/openrouter-adapter.ts";
import { estimateTokens, foldMessages } from "./folding-engine.ts";
import { fuseToolMessages } from "./tool-fuser.ts";
import { gateTools } from "./tool-gater.ts";
import {
	structureForCaching,
	shouldUseTokenEfficientTools,
} from "./prompt-cache.ts";
import { getResponseCache, providerFromModel } from "./response-cache.ts";
import type {
	GuardianRequest,
	GuardianResponse,
	OptimizationMetrics,
	RequestEvent,
} from "./types.ts";
import { shardMessages } from "./vcm-sharder.ts";
import { decideRetain } from "./retain-filter.ts";

// ─── In-Memory Analytics Store ───────────────────────────────────────────────

const requestLog: RequestEvent[] = [];
const latencyCache = new Map<string, number[]>();

function recordEvent(event: RequestEvent): void {
	requestLog.push(event);
	if (requestLog.length > 100_000) {
		requestLog.splice(0, requestLog.length - 50_000);
	}

	const latencies = latencyCache.get(event.model) || [];
	latencies.push(event.latencyMs);
	if (latencies.length > 100) latencies.shift();
	latencyCache.set(event.model, latencies);
}

function _getP95Latency(model: string): number {
	const latencies = latencyCache.get(model);
	if (!latencies || latencies.length === 0) return 0;
	const sorted = [...latencies].sort((a, b) => a - b);
	const idx = Math.floor(sorted.length * 0.95);
	return sorted[Math.min(idx, sorted.length - 1)];
}

// ─── Cost Calculation ────────────────────────────────────────────────────────

function calculateCost(
	model: string,
	promptTokens: number,
	completionTokens: number,
): number {
	const fingerprint = getModelFingerprint(model);
	if (!fingerprint) return 0;
	return (
		(promptTokens / 1_000_000) * fingerprint.inputCostPerMillion +
		(completionTokens / 1_000_000) * fingerprint.outputCostPerMillion
	);
}

function calculateBaselineCost(
	promptTokens: number,
	completionTokens: number,
): number {
	// Baseline: gpt-4o pricing
	return (
		(promptTokens / 1_000_000) * 2.5 + (completionTokens / 1_000_000) * 10.0
	);
}

// ─── Main Orchestrator ───────────────────────────────────────────────────────

export async function orchestrate(
	request: GuardianRequest,
): Promise<GuardianResponse> {
	const requestId = crypto.randomUUID();
	const startTime = performance.now();

	const optimization: OptimizationMetrics = {
		foldingApplied: false,
		shardingApplied: false,
		toolFusionApplied: false,
		totalTokensSaved: 0,
		totalSavingsUsd: 0,
	};

	let workingMessages = [...request.messages];

	// ── Step 1: Privacy Shield ────────────────────────────────────────────────
	for (let i = 0; i < workingMessages.length; i++) {
		const scan = scanPII(workingMessages[i].content);
		if (scan.blocked) {
			throw new Error(
				`Request blocked: prompt injection detected in message ${i}`,
			);
		}
		if (scan.piiDetected.length > 0) {
			workingMessages[i] = {
				...workingMessages[i],
				content: sanitizeText(workingMessages[i].content),
			};
		}
	}

	// ── Step 1b: Retain Pre-Filter ────────────────────────────────────────────
	// Drop low-signal turns (greetings, acknowledgements, restatements) BEFORE
	// any folding/sharding runs. This is the cheapest optimization in the
	// pipeline (sub-1ms local classifier, zero LLM calls) and prevents the
	// expensive stages from wasting tokens + compute on fixed overhead. ~73%
	// of agent turns are fixed overhead, so this fires often.
	{
		const filtered: typeof workingMessages = [];
		let dropped = 0;
		let tokensSaved = 0;
		// Track entities seen so far so the classifier can score novelty
		// (down-weights turns that only repeat known entities).
		const seenEntities = new Set<string>();
		for (const msg of workingMessages) {
			// Never drop system messages — they carry essential instructions.
			if (msg.role === "system") {
				filtered.push(msg);
				continue;
			}
			const verdict = decideRetain({ content: msg.content, role: msg.role, seenEntities: [...seenEntities] });
			if (verdict.retain) {
				filtered.push(msg);
				// Accumulate signal entities from kept turns for novelty scoring.
				for (const m of msg.content.match(/`[^`]+`|(?:[\w./-]+\.(?:ts|tsx|js|jsx|py|go|rs|md|json|yaml|yml|toml))|https?:\/\/[^\\s,)]+|(?:GET|POST|PUT|DELETE|PATCH)\s+[\w/:-]+|(?:gpt-4(?:\.\d)?|gpt-5(?:\.\d)?|claude-(?:3\.\d|4\.\d)|gemini-(?:\d\.\d)|o[13]|llama|mistral|deepseek)|[\d.]+(?:%|ms|s|tok|tokens|usd|\$)/gi) ?? []) {
					seenEntities.add(m.toLowerCase());
				}
			} else {
				dropped++;
				tokensSaved += estimateTokens(msg.content);
			}
		}
		if (dropped > 0) {
			workingMessages = filtered;
			optimization.retainFilterApplied = true;
			optimization.retainFilterDropped = dropped;
			optimization.retainFilterTokensSaved = tokensSaved;
			optimization.totalTokensSaved += tokensSaved;
		}
	}

	// ── Step 2: Tool Fusion ───────────────────────────────────────────────────
	if (request.enableToolFusion) {
		const toolResult = fuseToolMessages(workingMessages);
		workingMessages = toolResult.messages;
		if (toolResult.tokensSaved > 0) {
			optimization.toolFusionApplied = true;
			optimization.toolFusionTokensSaved = toolResult.tokensSaved;
			optimization.totalTokensSaved += toolResult.tokensSaved;
		}
	}

	// ── Step 2b: Tool Gating (lazy tool-schema loading) ──────────────────────
	// Filter the tool catalog down to the query-relevant subset BEFORE the
	// schemas are sent to the provider. Zero-LLM-call, sub-millisecond. This is
	// a form of prompt reduction, so it runs early — gated schemas mean fewer
	// tokens folded/sharded and fewer output tokens the model reasons over.
	let workingTools = request.tools;
	{
		const lastUserMsg =
			workingMessages.filter((m) => m.role === "user").pop()?.content || "";
		const gated = gateTools(request.tools, lastUserMsg, { maxTools: 8 });
		if (gated.removed > 0) {
			workingTools = gated.tools;
			optimization.toolGatingApplied = true;
			optimization.toolGatingRemoved = gated.removed;
		}
	}

	// ── Step 3: Semantic Folding ──────────────────────────────────────────────
	// Compute token count once and reuse for both folding and sharding gates.
	const originalPromptTokens = workingMessages.reduce(
		(sum, m) => sum + estimateTokens(m.content),
		0,
	);

	// Extract the user message once — both folding and sharding need it.
	const userMessage =
		workingMessages.filter((m) => m.role === "user").pop()?.content || "";

	if (request.enableFolding && originalPromptTokens > 1000) {
		const foldResult = foldMessages(workingMessages, {
			maxTokens: 2000,
			preserveSystem: true,
		});
		workingMessages = foldResult.messages;
		optimization.foldingApplied = true;
		optimization.foldingCompressionRatio = foldResult.metadata.compressionRatio;
		optimization.foldingTimeMs = foldResult.foldingTimeMs;
		optimization.totalTokensSaved +=
			foldResult.metadata.originalTokens - foldResult.metadata.foldedTokens;
	}

	// ── Step 3b: Memory Pack Injection (AI Trio / MemOS) ────────────────────
	// If a pre-built memory pack (e.g. a MemOS TOON context pack) was supplied,
	// inject it as a high-relevance context shard BEFORE sharding so the sharder
	// preserves it as a top anchor (like a system message). This lets Guardian
	// ground the model in token-budgeted memory from the memos sibling repo
	// instead of re-deriving everything from chat history. The pack is already
	// compressed (60-90% via TOON), so it adds little token overhead.
	if (request.memoryPack && request.memoryPack.trim().length > 0) {
		const packContent = request.memoryPack.trim();
		workingMessages.unshift({
			role: "system",
			content: `## Memory Context (from MemOS)\n${packContent}`,
		});
		const packTokens = estimateTokens(packContent);
		optimization.memoryPackInjected = true;
		optimization.memoryPackTokens = packTokens;
	}

	// ── Step 4: VCM Sharding ─────────────────────────────────────────────────
	// Gate on the POST-FOLD token count (not the original pre-fold count) so a
	// context that folding already shrank below the threshold isn't re-sharded
	// with a larger budget — that previously let sharding re-expand a folded
	// context back toward its original size. Size the shard budget to the
	// actual remaining context so sharding still *compresses* rather than
	// preserving everything.
	const postFoldTokens = workingMessages.reduce(
		(sum, m) => sum + estimateTokens(m.content),
		0,
	);
	if (request.enableSharding && postFoldTokens > 2000) {
		// Reuse the userMessage extracted before folding — the user's
		// latest query is the anchor for relevance scoring.
		const shardBudget = Math.min(3000, Math.floor(postFoldTokens * 0.9));
		const shardResult = shardMessages(workingMessages, userMessage, {
			maxTokens: shardBudget,
		});
		workingMessages = shardResult.messages;
		optimization.shardingApplied = true;
		optimization.shardingCompressionRatio =
			shardResult.shardingResult.compressionRatio;
		optimization.totalTokensSaved +=
			shardResult.shardingResult.originalTokens -
			shardResult.shardingResult.shardedTokens;
	}

	// ── Step 4b: Prompt Caching ───────────────────────────────────────────────
	// Reorder into a stable cacheable prefix + volatile suffix and stamp
	// Anthropic `cache_control` breakpoints on the prefix boundary. Also decide
	// the token-efficient-tools beta header (worth it whenever tools exist).
	// This is additive: if caching is disabled or the prefix is too small, the
	// messages pass through unchanged.
	let cachedMessages = workingMessages;
	let useTokenEfficientTools = false;
	{
		const structured = structureForCaching(workingMessages, {
			enableCaching: request.enablePromptCaching,
		});
		if (structured.cachingStructured) {
			cachedMessages = structured.messages;
			optimization.promptCachingApplied = true;
			optimization.promptCachingPrefixTokens = structured.prefixTokens;
		}
		useTokenEfficientTools =
			!!request.enablePromptCaching &&
			shouldUseTokenEfficientTools(workingTools);
		if (useTokenEfficientTools) {
			optimization.tokenEfficientToolsUsed = true;
		}
	}

	// ── Step 5: Model Selection & Budget Check ────────────────────────────────
	const finalPromptTokens = workingMessages.reduce(
		(sum, m) => sum + estimateTokens(m.content),
		0,
	);
	const estimatedCost = calculateCost(
		request.model,
		finalPromptTokens,
		request.maxTokens || 512,
	);

	const budgetStatus = checkBudget(estimatedCost);
	if (!budgetStatus.allowed) {
		throw new Error(`Budget exceeded: ${budgetStatus.reason}`);
	}

	// ── Step 6: Route to Model ────────────────────────────────────────────────
	const selectedModel = selectModel(request.model, {
		maxTokens: request.maxTokens,
		needsVision: false,
		needsStreaming: request.stream,
	});

	// ── Step 6b: Response Cache Check ─────────────────────────────────────────
	// After all optimization, check if we've already computed this exact
	// response. The cache key includes the optimized messages, model, and
	// tools — so any change in the optimized request produces a different key.
	// This skips the provider call entirely on cache hits.
	const cache = getResponseCache();
	const cacheKey = cache.buildKey(selectedModel, cachedMessages, workingTools);
	const cached = cache.get(cacheKey);
	if (cached) {
		const latencyMs = performance.now() - startTime;
		const event: RequestEvent = {
			requestId,
			model: selectedModel,
			// Use the stored provider, not the router name — a cache hit must
			// report the same provider identity as a fresh dispatch.
			provider: cached.provider,
			promptTokens: cached.usage.promptTokens,
			completionTokens: cached.usage.completionTokens,
			costUsd: 0, // Free — cache hit
			baselineCostUsd: 0,
			savedUsd: 0,
			latencyMs,
			status: "ok",
			cacheHit: true,
			optimizationMetrics: optimization,
			timestamp: Date.now(),
		};
		recordEvent(event);

		return {
			id: requestId,
			model: selectedModel,
			// Invariant: cache key embeds model which embeds provider, but we
			// store provider explicitly so the hit response never shows the
			// router name (openrouter).
			provider: cached.provider,
			content: cached.content,
			usage: {
				promptTokens: cached.usage.promptTokens,
				completionTokens: cached.usage.completionTokens,
				totalTokens: cached.usage.totalTokens,
			},
			costUsd: 0,
			baselineCostUsd: 0,
			savedUsd: 0,
			latencyMs,
			optimization,
			cacheHit: true,
		};
	}

	// ── Step 7: Execute Completion ────────────────────────────────────────────
	const response = await complete({
		model: selectedModel,
		messages: cachedMessages,
		temperature: request.temperature,
		maxTokens: request.maxTokens,
		stream: false,
		tools: workingTools,
		tokenEfficientTools: useTokenEfficientTools,
	});

	// ── Step 8: Record Analytics ──────────────────────────────────────────────
	const latencyMs = performance.now() - startTime;
	const actualCost = calculateCost(
		selectedModel,
		response.usage.promptTokens,
		response.usage.completionTokens,
	);
	const baselineCost = calculateBaselineCost(
		response.usage.promptTokens,
		response.usage.completionTokens,
	);

	// ── Step 8b: Store Response in Cache ─────────────────────────────────────
	// Cache the response for future identical requests. Pass the real provider
	// (extracted from model ID) so cache-hit responses later report the correct
	// provider identity (not the router name).
	cache.set(
		cacheKey,
		response.content,
		selectedModel,
		providerFromModel(selectedModel),
		{
			promptTokens: response.usage.promptTokens,
			completionTokens: response.usage.completionTokens,
			totalTokens: response.usage.totalTokens,
		},
	);

	const event: RequestEvent = {
		requestId,
		model: selectedModel,
		provider: providerFromModel(selectedModel),
		promptTokens: response.usage.promptTokens,
		completionTokens: response.usage.completionTokens,
		costUsd: actualCost,
		baselineCostUsd: baselineCost,
		savedUsd: baselineCost - actualCost + optimization.totalSavingsUsd,
		latencyMs,
		status: "ok",
		cacheHit: false,
		optimizationMetrics: optimization,
		timestamp: Date.now(),
	};
	recordEvent(event);

	return {
		id: requestId,
		model: selectedModel,
		provider: providerFromModel(selectedModel),
		content: response.content,
		usage: response.usage,
		costUsd: actualCost,
		baselineCostUsd: baselineCost,
		savedUsd: event.savedUsd,
		latencyMs,
		optimization,
		cacheHit: false,
	};
}

// ─── Streaming Orchestrator ──────────────────────────────────────────────────

export async function* orchestrateStream(
	request: GuardianRequest,
): AsyncGenerator<string, GuardianResponse> {
	const requestId = crypto.randomUUID();
	const startTime = performance.now();

	// Same optimization pipeline as non-streaming
	let workingMessages = [...request.messages];
	const optimization: OptimizationMetrics = {
		foldingApplied: false,
		shardingApplied: false,
		toolFusionApplied: false,
		totalTokensSaved: 0,
		totalSavingsUsd: 0,
	};

	// Privacy scan
	for (const msg of workingMessages) {
		const scan = scanPII(msg.content);
		if (scan.blocked)
			throw new Error("Request blocked: prompt injection detected");
	}

	// Retain Pre-Filter (same local classifier as the non-streaming path)
	{
		const filtered: typeof workingMessages = [];
		let dropped = 0;
		let tokensSaved = 0;
		for (const msg of workingMessages) {
			if (msg.role === "system") {
				filtered.push(msg);
				continue;
			}
			const verdict = decideRetain({ content: msg.content, role: msg.role });
			if (verdict.retain) {
				filtered.push(msg);
			} else {
				dropped++;
				tokensSaved += estimateTokens(msg.content);
			}
		}
		if (dropped > 0) {
			workingMessages = filtered;
			optimization.retainFilterApplied = true;
			optimization.retainFilterDropped = dropped;
			optimization.retainFilterTokensSaved = tokensSaved;
			optimization.totalTokensSaved += tokensSaved;
		}
	}

	// Folding
	const originalTokens = workingMessages.reduce(
		(sum, m) => sum + estimateTokens(m.content),
		0,
	);
	if (request.enableFolding && originalTokens > 1000) {
		const foldResult = foldMessages(workingMessages);
		workingMessages = foldResult.messages;
		optimization.foldingApplied = true;
		optimization.foldingCompressionRatio = foldResult.metadata.compressionRatio;
		optimization.totalTokensSaved +=
			foldResult.metadata.originalTokens - foldResult.metadata.foldedTokens;
	}

	// Tool Gating (same as non-streaming path)
	let workingTools = request.tools;
	{
		const lastUserMsg =
			workingMessages.filter((m) => m.role === "user").pop()?.content || "";
		const gated = gateTools(request.tools, lastUserMsg, { maxTools: 8 });
		if (gated.removed > 0) {
			workingTools = gated.tools;
			optimization.toolGatingApplied = true;
			optimization.toolGatingRemoved = gated.removed;
		}
	}

	// Prompt Caching (same as non-streaming path)
	let cachedMessages = workingMessages;
	{
		const structured = structureForCaching(workingMessages, {
			enableCaching: request.enablePromptCaching,
		});
		if (structured.cachingStructured) {
			cachedMessages = structured.messages;
			optimization.promptCachingApplied = true;
			optimization.promptCachingPrefixTokens = structured.prefixTokens;
		}
	}

	const selectedModel = selectModel(request.model);
	const estimatedCost = calculateCost(
		selectedModel,
		workingMessages.reduce((s, m) => s + estimateTokens(m.content), 0),
		request.maxTokens || 512,
	);
	const budgetStatus = checkBudget(estimatedCost);
	if (!budgetStatus.allowed)
		throw new Error(`Budget exceeded: ${budgetStatus.reason}`);

	let fullContent = "";

	// Stream chunks from the provider via completeStream() generator
	const stream = completeStream({
		model: selectedModel,
		messages: cachedMessages,
		temperature: request.temperature,
		maxTokens: request.maxTokens,
		stream: true,
		tools: workingTools,
	});

	let result = await stream.next();
	while (!result.done) {
		fullContent += result.value;
		yield result.value;
		result = await stream.next();
	}

	// result.value is CompletionResponse from the generator's return
	const response = result.value;

	const latencyMs = performance.now() - startTime;
	const actualCost = calculateCost(
		selectedModel,
		response.usage.promptTokens,
		response.usage.completionTokens,
	);
	const baselineCost = calculateBaselineCost(
		response.usage.promptTokens,
		response.usage.completionTokens,
	);

	recordSpend(actualCost);
	recordEvent({
		requestId,
		model: selectedModel,
		provider: providerFromModel(selectedModel),
		promptTokens: response.usage.promptTokens,
		completionTokens: response.usage.completionTokens,
		costUsd: actualCost,
		baselineCostUsd: baselineCost,
		savedUsd: baselineCost - actualCost,
		latencyMs,
		status: "ok",
		cacheHit: false,
		optimizationMetrics: optimization,
		timestamp: Date.now(),
	});

	return {
		id: requestId,
		model: selectedModel,
		provider: providerFromModel(selectedModel),
		content: fullContent,
		usage: response.usage,
		costUsd: actualCost,
		baselineCostUsd: baselineCost,
		savedUsd: baselineCost - actualCost,
		latencyMs,
		optimization,
	};
}

// ─── Analytics API ───────────────────────────────────────────────────────────

export function getStats() {
	const total = requestLog.length;
	const totalCost = requestLog.reduce((s, e) => s + e.costUsd, 0);
	const totalBaseline = requestLog.reduce((s, e) => s + e.baselineCostUsd, 0);
	const totalSaved = requestLog.reduce((s, e) => s + e.savedUsd, 0);
	const avgLatency =
		total > 0 ? requestLog.reduce((s, e) => s + e.latencyMs, 0) / total : 0;
	const cacheHits = requestLog.filter((e) => e.cacheHit).length;
	const cacheHitRate = total > 0 ? cacheHits / total : 0;

	const now = Date.now();
	const dayAgo = now - 86_400_000;
	const todayEvents = requestLog.filter((e) => e.timestamp > dayAgo);
	const todayCost = todayEvents.reduce((s, e) => s + e.costUsd, 0);
	const todaySaved = todayEvents.reduce((s, e) => s + e.savedUsd, 0);

	const monthAgo = now - 30 * 86_400_000;
	const monthEvents = requestLog.filter((e) => e.timestamp > monthAgo);
	const monthCost = monthEvents.reduce((s, e) => s + e.costUsd, 0);
	const monthSaved = monthEvents.reduce((s, e) => s + e.savedUsd, 0);

	// Optimization metrics
	const optimizedEvents = requestLog.filter((e) => e.optimizationMetrics);
	const avgCompression =
		optimizedEvents.length > 0
			? optimizedEvents.reduce(
					(s, e) => s + (e.optimizationMetrics?.foldingCompressionRatio ?? 1),
					0,
				) / optimizedEvents.length
			: 1;
	const totalTokensOptimized = optimizedEvents.reduce(
		(s, e) => s + (e.optimizationMetrics?.totalTokensSaved ?? 0),
		0,
	);

	return {
		totalRequests: total,
		totalCostUsd: totalCost,
		totalBaselineCostUsd: totalBaseline,
		totalSavedUsd: totalSaved,
		avgLatencyMs: avgLatency,
		cacheHitRate,
		avgCompressionRatio: avgCompression,
		totalTokensOptimized,
		today: {
			requests: todayEvents.length,
			costUsd: todayCost,
			savedUsd: todaySaved,
		},
		month: {
			requests: monthEvents.length,
			costUsd: monthCost,
			savedUsd: monthSaved,
		},
	};
}

export function getRequestLog(limit = 100, offset = 0) {
	const items = requestLog
		.slice()
		.reverse()
		.slice(offset, offset + limit);
	return {
		total: requestLog.length,
		limit,
		offset,
		items,
	};
}

export default {
	orchestrate,
	orchestrateStream,
	getStats,
	getRequestLog,
};
