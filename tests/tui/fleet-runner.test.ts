import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { createFleetPlan } from "../../src/tui/fleet.ts";
import {
	cancelFleetRun,
	createFleetRun,
	executeReadOnlyFleetRun,
	renderFleetRun,
} from "../../src/tui/fleet-runner.ts";
import type { GuardianSnapshot } from "../../src/tui/types.ts";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "guardian-fleet-"));
	roots.push(root);
	return root;
}

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
			model: "openai/gpt-5.5",
			provider: "openai",
			inputPerMillion: 5,
			outputPerMillion: 30,
			p95LatencyMs: 0,
			contextWindow: 1_000_000,
			supportsTools: true,
			supportsVision: true,
		},
	],
	rules: [],
	budget: {
		dailySpentUsd: 0,
		dailyLimitUsd: 20,
		monthlySpentUsd: 0,
		monthlyLimitUsd: 100,
	},
	loadedAt: new Date(0),
};

test("createFleetRun writes dry-run manifest, prompts, and merge outputs", () => {
	const root = tempRoot();
	const plan = createFleetPlan(["--dry-run", "--max", "3", "fix", "tests"], snapshot);
	const run = createFleetRun(plan, root);

	expect(run.status).toBe("done");
	expect(run.manifestPath).toBeTruthy();
	expect(existsSync(run.manifestPath ?? "")).toBe(true);
	expect(run.prompts.length).toBe(plan.lanes.length);
	expect(run.prompts[0].system).toContain("Guardian fleet worker");
	expect(run.merge.canAutoApply).toBe(false);
	expect(run.merge.expectedOutputs.length).toBeGreaterThan(0);
	expect(run.worktree.workspaceMode).toBe("shared-readonly");

	const manifest = JSON.parse(readFileSync(run.manifestPath ?? "", "utf8"));
	expect(manifest.id).toBe(run.id);
	expect(manifest.manifestPath).toBe(run.manifestPath);
});

test("createFleetRun records blocked run requests without executing workers", () => {
	const root = tempRoot();
	const plan = createFleetPlan(["--run", "--max", "3", "refactor", "router"], snapshot);
	const run = createFleetRun(plan, root);

	expect(run.status).toBe("blocked");
	expect(run.plan.policy.canExecute).toBe(false);
	expect(run.worktree.workspaceMode).toBe("per-lane-worktree");
	expect(run.worktree.blockers.join("\n")).toContain("Git worktree");
	expect(renderFleetRun(run)).toContain("Execution blockers");
});

test("createFleetRun queues explicit read-only executor runs", () => {
	const root = tempRoot();
	const plan = createFleetPlan(
		["--run", "--execute-readonly", "--max", "1", "inspect", "router"],
		snapshot,
	);
	const run = createFleetRun(plan, root);

	expect(run.status).toBe("queued");
	expect(run.plan.policy.executor).toBe("single-readonly");
	expect(run.prompts).toHaveLength(1);
	expect(run.prompts[0].allowedTools).toEqual(["read"]);
	expect(renderFleetRun(run)).toContain("Executor: single-readonly");
});

test("executeReadOnlyFleetRun calls chat client and writes lane summary", async () => {
	const root = tempRoot();
	const plan = createFleetPlan(
		["--run", "--execute-readonly", "--max", "1", "inspect", "router"],
		snapshot,
	);
	const run = createFleetRun(plan, root);
	const seen: { model?: string; messageCount?: number } = {};
	const executed = await executeReadOnlyFleetRun(run, {
		async chat(messages, model) {
			seen.model = model;
			seen.messageCount = messages.length;
			return {
				content: "Read-only findings.",
				model: model ?? "auto",
				costUsd: 0.01,
				savedUsd: 0.02,
				latencyMs: 12,
				tokensSaved: 100,
			};
		},
	});

	expect(seen.model).toBe("openai/gpt-5.5");
	expect(seen.messageCount).toBe(2);
	expect(executed.status).toBe("done");
	expect(executed.lanes[0].state).toBe("done");
	expect(existsSync(executed.lanes[0].summaryPath)).toBe(true);
	expect(readFileSync(executed.lanes[0].summaryPath, "utf8")).toContain(
		"Read-only findings.",
	);
});

test("executeReadOnlyFleetRun refuses blocked runs", async () => {
	const root = tempRoot();
	const plan = createFleetPlan(["--run", "--max", "1", "inspect", "router"], snapshot);
	const run = createFleetRun(plan, root);
	const refused = await executeReadOnlyFleetRun(run, {
		async chat() {
			throw new Error("should not call");
		},
	});

	expect(refused.status).toBe("blocked");
	expect(refused.events.at(-1)).toContain("execution refused");
});

test("cancelFleetRun cancels active lanes and preserves event history", () => {
	const root = tempRoot();
	const plan = createFleetPlan(["--run", "--max", "3", "refactor", "router"], snapshot);
	const run = createFleetRun(plan, root);
	const cancelled = cancelFleetRun(run);

	expect(cancelled.status).toBe("cancelled");
	expect(cancelled.events.at(-1)).toContain("cancelled");
	expect(cancelled.lanes.every((lane) => lane.exitReason)).toBe(true);
});

test("cancelFleetRun handles missing active run honestly", () => {
	const cancelled = cancelFleetRun(null);
	expect(cancelled.status).toBe("cancelled");
	expect(cancelled.events.join("\n")).toContain("no active run");
	expect(renderFleetRun(cancelled)).toContain("No active fleet run");
});
