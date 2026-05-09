import { getSpendSummary } from "../gateway/budget-manager.ts";
import { getRequestLog, getStats, orchestrate } from "../core/orchestrator.ts";
import { foldText as foldTextCore } from "../core/folding-engine.ts";
import { getAllFingerprints } from "../providers/fingerprints.ts";
import { loadOpenRouterCatalog } from "../providers/openrouter-catalog.ts";
import { getProjectRoot } from "./config.ts";
import type {
	ChatCompletionResult,
	ChatMessage,
	FoldTextResult,
	GuardianSnapshot,
	LogItem,
	ProviderModel,
	StatsSummary,
} from "./types.ts";

function statsFromCore(payload: ReturnType<typeof getStats>): StatsSummary {
	return {
		totalRequests: payload.totalRequests,
		totalCostUsd: payload.totalCostUsd,
		totalSavedUsd: payload.totalSavedUsd,
		baselineCostUsd: payload.totalBaselineCostUsd,
		avgLatencyMs: payload.avgLatencyMs,
		cacheHitRate: payload.cacheHitRate,
		avgCompressionRatio: payload.avgCompressionRatio,
		totalTokensOptimized: payload.totalTokensOptimized,
		todayRequests: payload.today.requests,
		todayCostUsd: payload.today.costUsd,
		todaySavedUsd: payload.today.savedUsd,
		monthRequests: payload.month.requests,
		monthCostUsd: payload.month.costUsd,
		monthSavedUsd: payload.month.savedUsd,
	};
}

function logFromCore(item: ReturnType<typeof getRequestLog>["items"][number]): LogItem {
	return {
		id: item.requestId,
		model: item.model,
		provider: item.provider,
		promptTokens: item.promptTokens,
		completionTokens: item.completionTokens,
		costUsd: item.costUsd,
		baselineCostUsd: item.baselineCostUsd,
		savedUsd: item.savedUsd,
		latencyMs: item.latencyMs,
		status: item.status,
		cacheHit: item.cacheHit,
		createdAt: new Date(item.timestamp).toISOString(),
	};
}

function providersFromCore(): ProviderModel[] {
	const models = new Map<string, ProviderModel>();
	for (const item of getAllFingerprints()) {
		models.set(item.modelName, {
			model: item.modelName,
			provider: item.provider,
			inputPerMillion: item.inputCostPerMillion,
			outputPerMillion: item.outputCostPerMillion,
			p95LatencyMs: 0,
			contextWindow: item.contextWindow,
			source: "fingerprint",
			supportsTools: item.supportsToolUse,
			supportsVision: item.supportsVision,
		});
	}
	return [...models.values()];
}

async function providersFromCatalog(): Promise<ProviderModel[]> {
	const catalog = await loadOpenRouterCatalog(getProjectRoot());
	return catalog.models.length > 0 ? catalog.models : providersFromCore();
}

export class LocalGuardianClient {
	async snapshot(): Promise<GuardianSnapshot> {
		const stats = getStats();
		const budget = getSpendSummary();
		const hasKey = Boolean(process.env.OPENROUTER_API_KEY);
		return {
			connected: true,
			message: hasKey
				? "local runtime"
				: "local runtime - set OPENROUTER_API_KEY for model calls",
			stats: statsFromCore(stats),
			logs: getRequestLog(25).items.map(logFromCore),
			providers: await providersFromCatalog(),
			rules: [],
			budget: {
				dailySpentUsd: budget.dailySpentUsd,
				dailyLimitUsd: budget.dailyLimitUsd,
				monthlySpentUsd: budget.monthlySpentUsd,
				monthlyLimitUsd: budget.monthlyLimitUsd,
			},
			loadedAt: new Date(),
		};
	}

	async chat(messages: ChatMessage[], model = "auto"): Promise<ChatCompletionResult> {
		const response = await orchestrate({
			model,
			messages,
			enableFolding: true,
			enableSharding: true,
			enableToolFusion: true,
		});
		return {
			content: response.content,
			model: response.model,
			costUsd: response.costUsd,
			savedUsd: response.savedUsd,
			latencyMs: response.latencyMs,
			tokensSaved: response.optimization.totalTokensSaved,
		};
	}

	async foldText(text: string, maxTokens = 2000): Promise<FoldTextResult> {
		const result = foldTextCore(text, { maxTokens });
		return {
			foldedPrompt: result.foldedPrompt,
			foldingTimeMs: result.foldingTimeMs,
			metadata: {
				originalTokens: result.metadata.originalTokens,
				foldedTokens: result.metadata.foldedTokens,
				compressionRatio: result.metadata.compressionRatio,
				semanticDensity: result.metadata.semanticDensity,
				entities: result.metadata.entities,
				actions: result.metadata.actions,
				headline: result.metadata.headline,
			},
		};
	}
}
