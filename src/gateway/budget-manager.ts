// Budget Manager — Enforcement of Cost Limits
// Tracks daily/monthly spend and enforces per-request and aggregate budgets

import type { BudgetStatus } from "../core/types.ts";

// ─── Configuration ───────────────────────────────────────────────────────────

interface BudgetConfig {
	maxRequestCostUsd: number;
	dailyBudgetUsd: number;
	monthlyBudgetUsd: number;
	expensiveThresholdUsd: number;
}

const defaultConfig: BudgetConfig = {
	maxRequestCostUsd: 1.0,
	dailyBudgetUsd: 50.0,
	monthlyBudgetUsd: 500.0,
	expensiveThresholdUsd: 0.5,
};

let config: BudgetConfig = { ...defaultConfig };

// ─── Spend Tracking ──────────────────────────────────────────────────────────

interface SpendRecord {
	amount: number;
	timestamp: number;
}

const spendLog: SpendRecord[] = [];

export function recordSpend(amount: number): void {
	spendLog.push({ amount, timestamp: Date.now() });
	// Keep only last 90 days
	const cutoff = Date.now() - 90 * 86_400_000;
	while (spendLog.length > 0 && spendLog[0].timestamp < cutoff) {
		spendLog.shift();
	}
}

function getDailySpend(): number {
	const dayStart = Date.now() - 86_400_000;
	return spendLog
		.filter((r) => r.timestamp > dayStart)
		.reduce((sum, r) => sum + r.amount, 0);
}

function getMonthlySpend(): number {
	const now = new Date();
	const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
	return spendLog
		.filter((r) => r.timestamp > monthStart)
		.reduce((sum, r) => sum + r.amount, 0);
}

// ─── Budget Checks ───────────────────────────────────────────────────────────

export function checkBudget(estimatedCostUsd: number): BudgetStatus {
	const dailySpent = getDailySpend();
	const monthlySpent = getMonthlySpend();

	// Per-request limit
	if (estimatedCostUsd > config.maxRequestCostUsd) {
		return {
			allowed: false,
			reason: `Request cost $${estimatedCostUsd.toFixed(4)} exceeds per-request limit $${config.maxRequestCostUsd.toFixed(4)}`,
			estimatedCostUsd,
			dailySpentUsd: dailySpent,
			dailyLimitUsd: config.dailyBudgetUsd,
			monthlySpentUsd: monthlySpent,
			monthlyLimitUsd: config.monthlyBudgetUsd,
		};
	}

	// Daily budget
	if (dailySpent + estimatedCostUsd > config.dailyBudgetUsd) {
		return {
			allowed: false,
			reason: `Daily budget would be exceeded: $${(dailySpent + estimatedCostUsd).toFixed(4)} > $${config.dailyBudgetUsd.toFixed(4)}`,
			estimatedCostUsd,
			dailySpentUsd: dailySpent,
			dailyLimitUsd: config.dailyBudgetUsd,
			monthlySpentUsd: monthlySpent,
			monthlyLimitUsd: config.monthlyBudgetUsd,
		};
	}

	// Monthly budget
	if (monthlySpent + estimatedCostUsd > config.monthlyBudgetUsd) {
		return {
			allowed: false,
			reason: `Monthly budget would be exceeded: $${(monthlySpent + estimatedCostUsd).toFixed(4)} > $${config.monthlyBudgetUsd.toFixed(4)}`,
			estimatedCostUsd,
			dailySpentUsd: dailySpent,
			dailyLimitUsd: config.dailyBudgetUsd,
			monthlySpentUsd: monthlySpent,
			monthlyLimitUsd: config.monthlyBudgetUsd,
		};
	}

	return {
		allowed: true,
		estimatedCostUsd,
		dailySpentUsd: dailySpent,
		dailyLimitUsd: config.dailyBudgetUsd,
		monthlySpentUsd: monthlySpent,
		monthlyLimitUsd: config.monthlyBudgetUsd,
	};
}

export function isExpensive(estimatedCostUsd: number): boolean {
	return estimatedCostUsd > config.expensiveThresholdUsd;
}

// ─── Configuration ───────────────────────────────────────────────────────────

export function configure(overrides: Partial<BudgetConfig>): void {
	config = { ...config, ...overrides };
}

export function getConfig(): BudgetConfig {
	return { ...config };
}

export function getSpendSummary() {
	return {
		dailySpentUsd: getDailySpend(),
		dailyLimitUsd: config.dailyBudgetUsd,
		monthlySpentUsd: getMonthlySpend(),
		monthlyLimitUsd: config.monthlyBudgetUsd,
		totalRecords: spendLog.length,
	};
}

export default {
	checkBudget,
	recordSpend,
	isExpensive,
	configure,
	getConfig,
	getSpendSummary,
};
