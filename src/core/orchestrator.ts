// Orchestrator — The Brain of LLM-Guardian
// Coordinates Semantic Folding, VCM Sharding, Tool Fusion,
// Privacy Shield, Budget Management, and Model Routing

import { checkBudget, recordSpend } from "../gateway/budget-manager.ts";
import { sanitizeText, scanPII } from "../gateway/privacy-shield.ts";
import { getModelFingerprint } from "../providers/fingerprints.ts";
import { complete, selectModel } from "../providers/openrouter-adapter.ts";
import { estimateTokens, foldMessages } from "./folding-engine.ts";
import { fuseToolMessages } from "./tool-fuser.ts";
import type {
	GuardianRequest,
	GuardianResponse,
	OptimizationMetrics,
	RequestEvent,
} from "./types.ts";
import { shardMessages } from "./vcm-sharder.ts";

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

	// ── Step 3: Semantic Folding ──────────────────────────────────────────────
	const originalPromptTokens = workingMessages.reduce(
		(sum, m) => sum + estimateTokens(m.content),
		0,
	);

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

	// ── Step 4: VCM Sharding ─────────────────────────────────────────────────
	if (request.enableSharding && originalPromptTokens > 2000) {
		const userMessage =
			workingMessages.filter((m) => m.role === "user").pop()?.content || "";
		const shardResult = shardMessages(workingMessages, userMessage, {
			maxTokens: 3000,
		});
		workingMessages = shardResult.messages;
		optimization.shardingApplied = true;
		optimization.shardingCompressionRatio =
			shardResult.shardingResult.compressionRatio;
		optimization.totalTokensSaved +=
			shardResult.shardingResult.originalTokens -
			shardResult.shardingResult.shardedTokens;
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

	// ── Step 7: Execute Completion ────────────────────────────────────────────
	const response = await complete({
		model: selectedModel,
		messages: workingMessages,
		temperature: request.temperature,
		maxTokens: request.maxTokens,
		stream: false,
		tools: request.tools,
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

	optimization.totalSavingsUsd =
		(optimization.totalTokensSaved / 1_000_000) * 2.5 +
		(baselineCost - actualCost);

	recordSpend(actualCost);

	const event: RequestEvent = {
		requestId,
		model: selectedModel,
		provider: "openrouter",
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
		provider: "openrouter",
		content: response.content,
		usage: response.usage,
		costUsd: actualCost,
		baselineCostUsd: baselineCost,
		savedUsd: event.savedUsd,
		latencyMs,
		optimization,
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

	// For now, collect full response (real streaming would use SSE)
	const response = await complete({
		model: selectedModel,
		messages: workingMessages,
		temperature: request.temperature,
		maxTokens: request.maxTokens,
		stream: false,
	});

	fullContent = response.content;
	yield fullContent;

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
		provider: "openrouter",
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
		provider: "openrouter",
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
