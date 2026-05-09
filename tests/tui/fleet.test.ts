import { expect, test } from "bun:test";
import { commandPaletteText, findCommand } from "../../src/tui/commands.ts";
import { createFleetPlan, renderFleetPlan } from "../../src/tui/fleet.ts";
import type { GuardianSnapshot } from "../../src/tui/types.ts";

const snapshot: GuardianSnapshot = {
	connected: true,
	message: "local runtime",
	stats: {
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
	},
	logs: [],
	providers: [
		{
			model: "anthropic/claude-opus-4.7",
			provider: "anthropic",
			inputPerMillion: 15,
			outputPerMillion: 75,
			p95LatencyMs: 0,
			contextWindow: 300_000,
			maxCompletionTokens: 64_000,
			source: "openrouter",
			supportsTools: true,
			supportsVision: true,
		},
		{
			model: "openai/gpt-5.2",
			provider: "openai",
			inputPerMillion: 5,
			outputPerMillion: 15,
			p95LatencyMs: 0,
			contextWindow: 200_000,
			source: "openrouter",
			supportsTools: true,
			supportsVision: false,
		},
	],
	rules: [],
	budget: {
		dailySpentUsd: 1,
		dailyLimitUsd: 10,
		monthlySpentUsd: 1,
		monthlyLimitUsd: 100,
	},
	loadedAt: new Date(0),
};

test("command registry exposes fleet command", () => {
	expect(findCommand("fleet")?.enabled).toBe(true);
	expect(commandPaletteText("/fl")).toContain("/fleet");
});

test("fleet plan caps large requests at 300 agents", () => {
	const plan = createFleetPlan(["999", "review", "repo"], snapshot);
	expect(plan.agents).toBe(300);
	expect(plan.mode).toBe("plan");
	expect(plan.warnings.join("\n")).toContain("capped at 300");
	expect(renderFleetPlan(plan)).toContain("300");
});

test("fleet plan allows small dry runs", () => {
	const plan = createFleetPlan(["--dry-run", "--agents", "4", "fix", "tests"], snapshot);
	expect(plan.agents).toBe(4);
	expect(plan.mode).toBe("dry-run");
	expect(plan.task).toBe("fix tests");
});

test("fleet plan caps concurrency separately from planned agents", () => {
	const plan = createFleetPlan(["--max", "99", "refactor", "router"], snapshot);
	expect(plan.agents).toBe(6);
	expect(plan.concurrency).toBe(6);
	expect(plan.mode).toBe("plan");
	expect(plan.warnings.join("\n")).toContain("capped at 8");
});

test("fleet plan builds provider pool and lane cost estimates", () => {
	const plan = createFleetPlan(["--dry-run", "--max", "4", "fix", "tests"], snapshot);
	expect(plan.providerPool.length).toBeGreaterThan(0);
	expect(plan.providerPool[0].model).toBe("anthropic/claude-opus-4.7");
	expect(plan.lanes[0].provider).toBe("anthropic");
	expect(plan.lanes[0].estimatedCostUsd).toBeGreaterThan(0);
	expect(plan.policy.estimatedCostUsd).toBeGreaterThan(0);
	expect(renderFleetPlan(plan)).toContain("Provider pool");
	expect(renderFleetPlan(plan)).toContain("Blockers");
});

test("fleet run requests are blocked until execution adapters exist", () => {
	const plan = createFleetPlan(["--run", "--max", "4", "refactor", "router"], snapshot);
	expect(plan.mode).toBe("run");
	expect(plan.state).toBe("blocked");
	expect(plan.policy.canExecute).toBe(false);
	expect(plan.policy.blockers.join("\n")).toContain("--execute-readonly");
	expect(plan.warnings.join("\n")).toContain("Run requested");
});

test("fleet read-only executor enables exactly one safe lane", () => {
	const plan = createFleetPlan(
		["--run", "--execute-readonly", "--max", "1", "inspect", "router"],
		snapshot,
	);
	expect(plan.mode).toBe("run");
	expect(plan.agents).toBe(1);
	expect(plan.state).toBe("queued");
	expect(plan.policy.canExecute).toBe(true);
	expect(plan.policy.executor).toBe("single-readonly");
	expect(plan.policy.executeLane).toBe(1);
	expect(plan.policy.merge).toBe("summary-only");
	expect(renderFleetPlan(plan)).toContain("Executor: single-readonly");
});

test("fleet read-only executor refuses non-read-only lanes", () => {
	const plan = createFleetPlan(
		[
			"--run",
			"--execute-readonly",
			"--execute-lane",
			"2",
			"--agents",
			"2",
			"inspect",
			"router",
		],
		snapshot,
	);
	expect(plan.policy.canExecute).toBe(false);
	expect(plan.policy.blockers.join("\n")).toContain("Lane 2 is not read-only");
});

test("fleet budget blocks plans above run cap", () => {
	const plan = createFleetPlan(
		["--dry-run", "--agents", "12", "--budget", "0.01", "audit", "repo"],
		snapshot,
	);
	expect(plan.policy.budgetState).toBe("blocked");
	expect(plan.policy.blockers.join("\n")).toContain("fleet run budget");
});

test("fleet cancel is explicit and does not pretend an active run exists", () => {
	const plan = createFleetPlan(["cancel"], snapshot);
	expect(plan.mode).toBe("cancel");
	expect(plan.state).toBe("blocked");
	expect(plan.policy.blockers.join("\n")).toContain("No active fleet run");
});
