import type {
	BudgetStatus,
	ChatCompletionResult,
	ChatMessage,
	FoldTextResult,
	GuardianSnapshot,
	LogItem,
	ProviderModel,
	RuleItem,
	StatsSummary,
} from "./types.ts";

const EMPTY_STATS: StatsSummary = {
	totalRequests: 0,
	totalCostUsd: 0,
	totalSavedUsd: 0,
	baselineCostUsd: 0,
	avgLatencyMs: 0,
	cacheHitRate: 0,
	avgCompressionRatio: 1,
	totalTokensOptimized: 0,
	todayRequests: 0,
	todayCostUsd: 0,
	todaySavedUsd: 0,
	monthRequests: 0,
	monthCostUsd: 0,
	monthSavedUsd: 0,
};

const EMPTY_BUDGET: BudgetStatus = {
	dailySpentUsd: 0,
	dailyLimitUsd: 0,
	monthlySpentUsd: 0,
	monthlyLimitUsd: 0,
};

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

function asBoolean(value: unknown): boolean {
	return typeof value === "boolean" ? value : false;
}

function periodRequests(payload: Record<string, unknown>): number {
	return asNumber(payload.requests ?? payload.request_count ?? payload.total_requests);
}

function periodCost(payload: Record<string, unknown>): number {
	return asNumber(payload.costUsd ?? payload.cost_usd ?? payload.total_cost_usd);
}

function periodSaved(payload: Record<string, unknown>): number {
	return asNumber(payload.savedUsd ?? payload.saved_usd ?? payload.total_saved_usd);
}

function normalizeStats(payload: unknown): StatsSummary {
	const record = asRecord(payload);
	const today = asRecord(record.today);
	const month = asRecord(record.month ?? record.last_30_days);
	return {
		totalRequests: asNumber(record.totalRequests ?? record.total_requests),
		totalCostUsd: asNumber(record.totalCostUsd ?? record.total_cost_usd),
		totalSavedUsd: asNumber(record.totalSavedUsd ?? record.total_saved_usd),
		baselineCostUsd: asNumber(
			record.totalBaselineCostUsd ?? record.baseline_cost_usd,
		),
		avgLatencyMs: asNumber(record.avgLatencyMs ?? record.avg_latency_ms),
		cacheHitRate: asNumber(record.cacheHitRate ?? record.cache_hit_rate),
		avgCompressionRatio: asNumber(
			record.avgCompressionRatio ?? record.avg_compression_ratio,
			1,
		),
		totalTokensOptimized: asNumber(
			record.totalTokensOptimized ?? record.total_tokens_optimized,
		),
		todayRequests: periodRequests(today),
		todayCostUsd: periodCost(today),
		todaySavedUsd: periodSaved(today),
		monthRequests: periodRequests(month),
		monthCostUsd: periodCost(month),
		monthSavedUsd: periodSaved(month),
	};
}

function normalizeLog(payload: unknown): LogItem {
	const record = asRecord(payload);
	return {
		id: asString(record.id ?? record.requestId ?? record.request_id),
		model: asString(record.model),
		provider: asString(record.provider),
		promptTokens: asNumber(record.promptTokens ?? record.prompt_tokens),
		completionTokens: asNumber(record.completionTokens ?? record.completion_tokens),
		costUsd: asNumber(record.costUsd ?? record.cost_usd),
		baselineCostUsd: asNumber(record.baselineCostUsd ?? record.baseline_cost_usd),
		savedUsd: asNumber(record.savedUsd ?? record.saved_usd),
		latencyMs: asNumber(record.latencyMs ?? record.latency_ms),
		status: asString(record.status, "unknown"),
		cacheHit: asBoolean(record.cacheHit ?? record.cache_hit),
		createdAt: typeof record.created_at === "string" ? record.created_at : null,
	};
}

function normalizeProviders(payload: unknown): ProviderModel[] {
	const record = asRecord(payload);
	const nested: ProviderModel[] = asArray(record.providers).flatMap((providerPayload) => {
		const providerRecord = asRecord(providerPayload);
		const provider = asString(providerRecord.provider);
		return asArray(providerRecord.models).map((modelPayload) => {
			const modelRecord = asRecord(modelPayload);
			const pricing = asRecord(modelRecord.pricing);
			return {
				model: asString(modelRecord.model),
				provider,
				inputPerMillion: asNumber(
					pricing.input_per_million ??
						modelRecord.inputPerMillion ??
						modelRecord.inputCostPerMillion,
				),
				outputPerMillion: asNumber(
					pricing.output_per_million ??
						modelRecord.outputPerMillion ??
						modelRecord.outputCostPerMillion,
				),
				p95LatencyMs: asNumber(modelRecord.p95_latency_ms),
				contextWindow: asNumber(modelRecord.contextWindow, Number.NaN),
				maxCompletionTokens: asNumber(
					modelRecord.maxCompletionTokens,
					Number.NaN,
				),
				source:
					asString(modelRecord.source) === "openrouter"
						? "openrouter"
						: "guardian-api",
				catalogUpdatedAt: asString(modelRecord.catalogUpdatedAt),
				createdAt: asString(modelRecord.createdAt),
				supportsTools: asBoolean(
					modelRecord.supportsTools ?? modelRecord.supportsToolUse,
				),
				supportsVision: asBoolean(modelRecord.supportsVision),
			};
		});
	});
	if (nested.length > 0) return nested;
	return asArray(record.models).map((modelPayload): ProviderModel => {
		const modelRecord = asRecord(modelPayload);
		return {
			model: asString(modelRecord.model),
			provider: asString(modelRecord.provider),
			inputPerMillion: asNumber(
				modelRecord.inputCostPerMillion ?? modelRecord.input_per_million,
			),
			outputPerMillion: asNumber(
				modelRecord.outputCostPerMillion ?? modelRecord.output_per_million,
			),
			p95LatencyMs: asNumber(modelRecord.p95_latency_ms),
			contextWindow: asNumber(modelRecord.contextWindow, Number.NaN),
			maxCompletionTokens: asNumber(modelRecord.maxCompletionTokens, Number.NaN),
			source: asString(modelRecord.source) === "openrouter" ? "openrouter" : "guardian-api",
			catalogUpdatedAt: asString(modelRecord.catalogUpdatedAt),
			createdAt: asString(modelRecord.createdAt),
			supportsTools: asBoolean(
				modelRecord.supportsTools ?? modelRecord.supportsToolUse,
			),
			supportsVision: asBoolean(modelRecord.supportsVision),
		};
	});
}

function normalizeRule(payload: unknown): RuleItem {
	const record = asRecord(payload);
	return {
		id: asString(record.id),
		name: asString(record.name),
		ruleType: asString(record.rule_type ?? record.ruleType),
		priority: asNumber(record.priority),
		isActive: asBoolean(record.is_active ?? record.isActive),
	};
}

function normalizeBudget(payload: unknown): BudgetStatus {
	const record = asRecord(payload);
	return {
		dailySpentUsd: asNumber(record.dailySpentUsd ?? record.daily_spent_usd),
		dailyLimitUsd: asNumber(record.dailyLimitUsd ?? record.daily_limit_usd),
		monthlySpentUsd: asNumber(record.monthlySpentUsd ?? record.monthly_spent_usd),
		monthlyLimitUsd: asNumber(record.monthlyLimitUsd ?? record.monthly_limit_usd),
	};
}

function normalizeStringArray(value: unknown): string[] {
	return asArray(value).filter((item): item is string => typeof item === "string");
}

function normalizeFoldTextResult(payload: unknown): FoldTextResult {
	const record = asRecord(payload);
	const metadata = asRecord(record.metadata);
	return {
		foldedPrompt: asString(record.foldedPrompt ?? record.folded_prompt),
		foldingTimeMs: asNumber(record.foldingTimeMs ?? record.folding_time_ms),
		metadata: {
			originalTokens: asNumber(metadata.originalTokens ?? metadata.original_tokens),
			foldedTokens: asNumber(metadata.foldedTokens ?? metadata.folded_tokens),
			compressionRatio: asNumber(
				metadata.compressionRatio ?? metadata.compression_ratio,
				1,
			),
			semanticDensity: asNumber(
				metadata.semanticDensity ?? metadata.semantic_density,
			),
			entities: normalizeStringArray(metadata.entities),
			actions: normalizeStringArray(metadata.actions),
			headline: asString(metadata.headline),
		},
	};
}

export class GuardianApiClient {
	private readonly apiUrl: string;
	private readonly adminKey?: string;

	constructor(apiUrl: string, adminKey?: string) {
		this.apiUrl = apiUrl.replace(/\/+$/, "");
		this.adminKey = adminKey;
	}

	private async getJson(path: string, requireAuth = true): Promise<unknown> {
		const headers: Record<string, string> = {};
		if (requireAuth && this.adminKey) {
			headers["X-Guardian-Key"] = this.adminKey;
			headers.Authorization = `Bearer ${this.adminKey}`;
		}
		const response = await fetch(`${this.apiUrl}${path}`, { headers });
		if (!response.ok) {
			throw new Error(`${path} returned HTTP ${response.status}`);
		}
		return response.json();
	}

	async snapshot(): Promise<GuardianSnapshot> {
		try {
			await this.getJson("/health", false);
			const [summaryResult, logsResult, providersResult, rulesResult, budgetResult] =
				await Promise.allSettled([
					this.getJson("/api/v1/stats/summary"),
					this.getJson("/api/v1/logs?limit=25"),
					this.getJson("/api/v1/providers"),
					this.getJson("/api/v1/rules"),
					this.getJson("/api/v1/budget"),
				]);

			const summary =
				summaryResult.status === "fulfilled"
					? normalizeStats(summaryResult.value)
					: EMPTY_STATS;
			const logs =
				logsResult.status === "fulfilled"
					? asArray(asRecord(logsResult.value).items).map(normalizeLog)
					: [];
			const providers =
				providersResult.status === "fulfilled"
					? normalizeProviders(providersResult.value)
					: [];
			const rules =
				rulesResult.status === "fulfilled"
					? asArray(asRecord(rulesResult.value).rules).map(normalizeRule)
					: [];
			const budget =
				budgetResult.status === "fulfilled"
					? normalizeBudget(budgetResult.value)
					: EMPTY_BUDGET;
			const partialFailures = [
				summaryResult,
				logsResult,
				providersResult,
				rulesResult,
				budgetResult,
			].filter((result) => result.status === "rejected").length;

			return {
				connected: true,
				message:
					partialFailures > 0
						? `online with ${partialFailures} unavailable panel(s)`
						: "online",
				stats: summary,
				logs,
				providers,
				rules,
				budget,
				loadedAt: new Date(),
			};
		} catch (error) {
			return {
				connected: false,
				message: error instanceof Error ? error.message : "backend unavailable",
				stats: EMPTY_STATS,
				logs: [],
				providers: [],
				rules: [],
				budget: EMPTY_BUDGET,
				loadedAt: new Date(),
			};
		}
	}

	async chat(messages: ChatMessage[], model = "auto"): Promise<ChatCompletionResult> {
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (this.adminKey) {
			headers["X-Guardian-Key"] = this.adminKey;
			headers.Authorization = `Bearer ${this.adminKey}`;
		}
		const response = await fetch(`${this.apiUrl}/v1/chat/completions`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				model,
				messages,
				enable_folding: true,
				enable_sharding: true,
				enable_tool_fusion: true,
			}),
		});
		if (!response.ok) {
			throw new Error(`/v1/chat/completions returned HTTP ${response.status}`);
		}
		const payload = asRecord(await response.json());
		const choice = asRecord(asArray(payload.choices)[0]);
		const message = asRecord(choice.message);
		const guardian = asRecord(payload.guardian);
		const optimization = asRecord(guardian.optimization);
		return {
			content: asString(message.content, "No response content returned."),
			model: asString(payload.model, model),
			costUsd: asNumber(guardian.cost_usd),
			savedUsd: asNumber(guardian.saved_usd),
			latencyMs: asNumber(guardian.latency_ms),
			tokensSaved: asNumber(optimization.totalTokensSaved),
		};
	}

	async foldText(text: string, maxTokens = 2000): Promise<FoldTextResult> {
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (this.adminKey) {
			headers["X-Guardian-Key"] = this.adminKey;
			headers.Authorization = `Bearer ${this.adminKey}`;
		}
		const response = await fetch(`${this.apiUrl}/api/v1/fold`, {
			method: "POST",
			headers,
			body: JSON.stringify({ text, maxTokens }),
		});
		if (!response.ok) {
			throw new Error(`/api/v1/fold returned HTTP ${response.status}`);
		}
		return normalizeFoldTextResult(await response.json());
	}
}
