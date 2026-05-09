export interface GuardianTuiOptions {
	apiUrl?: string;
	adminKey?: string;
	refreshMs?: number;
	configPath?: string;
	model?: string;
	agent?: string;
	continueLast?: boolean;
	sessionId?: string;
	forkSession?: boolean;
	prompt?: string;
}

export interface GuardianConfig {
	apiUrl: string;
	adminKeyEnv: string;
	refreshMs: number;
	theme: string;
	defaultModel: string;
	siblings: {
		memos: string;
		universalMcpToolkit: string;
	};
}

export interface StatsSummary {
	totalRequests: number;
	totalCostUsd: number;
	totalSavedUsd: number;
	baselineCostUsd: number;
	avgLatencyMs: number;
	cacheHitRate: number;
	avgCompressionRatio: number;
	totalTokensOptimized: number;
	todayRequests: number;
	todayCostUsd: number;
	todaySavedUsd: number;
	monthRequests: number;
	monthCostUsd: number;
	monthSavedUsd: number;
}

export interface LogItem {
	id: string;
	model: string;
	provider: string;
	promptTokens: number;
	completionTokens: number;
	costUsd: number;
	baselineCostUsd: number;
	savedUsd: number;
	latencyMs: number;
	status: string;
	cacheHit: boolean;
	createdAt: string | null;
}

export interface ProviderModel {
	model: string;
	provider: string;
	inputPerMillion: number;
	outputPerMillion: number;
	p95LatencyMs: number;
	contextWindow?: number;
	maxCompletionTokens?: number;
	source?: "openrouter" | "fingerprint" | "guardian-api";
	catalogUpdatedAt?: string;
	createdAt?: string;
	supportsTools?: boolean;
	supportsVision?: boolean;
}

export interface RuleItem {
	id: string;
	name: string;
	ruleType: string;
	priority: number;
	isActive: boolean;
}

export interface BudgetStatus {
	dailySpentUsd: number;
	dailyLimitUsd: number;
	monthlySpentUsd: number;
	monthlyLimitUsd: number;
}

export interface GuardianSnapshot {
	connected: boolean;
	message: string;
	stats: StatsSummary;
	logs: LogItem[];
	providers: ProviderModel[];
	rules: RuleItem[];
	budget: BudgetStatus;
	loadedAt: Date;
}

export interface SiblingStatus {
	id: "memos" | "universal-mcp-toolkit";
	label: string;
	path: string;
	exists: boolean;
	hasGit: boolean;
	packageName: string;
	version: string;
	note: string;
}

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface ChatTurn {
	id: string;
	role: "user" | "assistant";
	content: string;
	status?: "pending" | "error" | "done";
	model?: string;
	costUsd?: number;
	savedUsd?: number;
	latencyMs?: number;
	tokensSaved?: number;
}

export interface ChatCompletionResult {
	content: string;
	model: string;
	costUsd: number;
	savedUsd: number;
	latencyMs: number;
	tokensSaved: number;
}

export interface FoldTextResult {
	foldedPrompt: string;
	foldingTimeMs: number;
	metadata: {
		originalTokens: number;
		foldedTokens: number;
		compressionRatio: number;
		semanticDensity: number;
		entities: string[];
		actions: string[];
		headline: string;
	};
}
