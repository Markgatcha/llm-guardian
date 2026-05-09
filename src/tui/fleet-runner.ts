import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { money, numberShort } from "./format.ts";
import type { FleetLane, FleetPlan, FleetState } from "./fleet.ts";
import type { ChatCompletionResult, ChatMessage } from "./types.ts";

export type FleetRunStatus =
	| "blocked"
	| "queued"
	| "running"
	| "cancelled"
	| "done"
	| "failed";

export interface FleetWorkerPrompt {
	laneId: number;
	provider: string;
	model: string;
	system: string;
	user: string;
	allowedTools: string[];
	fileScope: string;
	budgetUsd: number;
}

export interface FleetWorktreePlan {
	strategy: "read-only" | "sandbox-required" | "worktree-required";
	runDir: string;
	workspaceMode: "shared-readonly" | "per-lane-worktree";
	laneDirs: Array<{ laneId: number; path: string; canWrite: boolean }>;
	blockers: string[];
}

export interface FleetMergeManifest {
	strategy: "summary-only" | "patch-review" | "blocked";
	canAutoApply: boolean;
	conflictPolicy: string;
	expectedOutputs: Array<{
		laneId: number;
		kind: "summary" | "patch" | "test-log";
		path: string;
	}>;
	protectedScopes: string[];
}

export interface FleetLaneRun {
	laneId: number;
	state: FleetState;
	startedAt?: string;
	finishedAt?: string;
	exitReason?: string;
	summaryPath: string;
	actualModel?: string;
	actualCostUsd?: number;
	actualSavedUsd?: number;
	latencyMs?: number;
}

export interface FleetRun {
	id: string;
	status: FleetRunStatus;
	createdAt: string;
	updatedAt: string;
	task: string;
	plan: FleetPlan;
	worktree: FleetWorktreePlan;
	merge: FleetMergeManifest;
	prompts: FleetWorkerPrompt[];
	lanes: FleetLaneRun[];
	events: string[];
	manifestPath?: string;
}

export interface FleetChatClient {
	chat(messages: ChatMessage[], model?: string): Promise<ChatCompletionResult>;
}

function allowedToolsForLane(lane: FleetLane): string[] {
	if (lane.toolLimit === "read-only") return ["read"];
	if (lane.toolLimit === "tests allowed") return ["read", "test"];
	return ["read", "patch-proposal"];
}

function workerPrompt(plan: FleetPlan, lane: FleetLane): FleetWorkerPrompt {
	return {
		laneId: lane.id,
		provider: lane.provider,
		model: lane.model,
		fileScope: lane.fileScope,
		allowedTools: allowedToolsForLane(lane),
		budgetUsd: lane.estimatedCostUsd,
		system: [
			"You are a Guardian fleet worker.",
			"Stay inside the assigned file scope and tool limit.",
			"Return a concise result with findings, proposed changes, tests, risks, and merge notes.",
			"Never overwrite another lane's work. Report conflicts instead.",
		].join(" "),
		user: [
			`Fleet task: ${plan.task}`,
			`Lane ${lane.id}: ${lane.role}`,
			`Focus: ${lane.focus}`,
			`File scope: ${lane.fileScope}`,
			`Dependencies: ${lane.dependsOn.join(", ") || "none"}`,
			`Budget: ${money(lane.estimatedCostUsd)}`,
		].join("\n"),
	};
}

function createWorktreePlan(plan: FleetPlan, projectRoot: string): FleetWorktreePlan {
	const runDir = join(projectRoot, ".guardian", "fleet", "runs", plan.id);
	const workspaceMode =
		plan.policy.isolation === "read-only" ? "shared-readonly" : "per-lane-worktree";
	return {
		strategy: plan.policy.isolation,
		runDir,
		workspaceMode,
		laneDirs: plan.lanes.map((lane) => ({
			laneId: lane.id,
			path: join(runDir, `lane-${String(lane.id).padStart(3, "0")}`),
			canWrite: workspaceMode === "per-lane-worktree",
		})),
		blockers:
			workspaceMode === "per-lane-worktree"
				? [
						"Git worktree creation is not enabled from the TUI yet.",
						"Per-lane dependency setup scripts are not defined yet.",
					]
				: [],
	};
}

function createMergeManifest(plan: FleetPlan): FleetMergeManifest {
	return {
		strategy: plan.policy.merge,
		canAutoApply: false,
		conflictPolicy:
			"Collect lane outputs first. Auto-apply is disabled until diff ownership and conflict checks are implemented.",
		expectedOutputs: plan.lanes.flatMap((lane) => {
			const base = `.guardian/fleet/runs/${plan.id}/lane-${String(lane.id).padStart(3, "0")}`;
			const outputs: FleetMergeManifest["expectedOutputs"] = [
				{ laneId: lane.id, kind: "summary", path: `${base}/summary.md` },
			];
			if (lane.toolLimit === "patch proposal") {
				outputs.push({ laneId: lane.id, kind: "patch", path: `${base}/changes.patch` });
			}
			if (lane.toolLimit === "tests allowed") {
				outputs.push({ laneId: lane.id, kind: "test-log", path: `${base}/test.log` });
			}
			return outputs;
		}),
		protectedScopes: [
			".git/**",
			".guardian/config.json",
			".guardian/cache/**",
			"node_modules/**",
		],
	};
}

function laneRun(plan: FleetPlan, lane: FleetLane): FleetLaneRun {
	return {
		laneId: lane.id,
		state: plan.policy.canExecute ? lane.state : "blocked",
		exitReason: plan.policy.canExecute
			? undefined
			: "Execution blocked by fleet policy.",
		summaryPath: `.guardian/fleet/runs/${plan.id}/lane-${String(lane.id).padStart(3, "0")}/summary.md`,
	};
}

function writeRunManifest(run: FleetRun): string {
	const runDir = run.worktree.runDir;
	mkdirSync(runDir, { recursive: true });
	for (const lane of run.worktree.laneDirs) {
		mkdirSync(lane.path, { recursive: true });
	}
	const manifestPath = join(runDir, "manifest.json");
	writeFileSync(
		manifestPath,
		`${JSON.stringify({ ...run, manifestPath }, null, 2)}\n`,
		"utf8",
	);
	return manifestPath;
}

function writeLaneSummary(run: FleetRun, laneId: number, content: string): string {
	const laneDir =
		run.worktree.laneDirs.find((lane) => lane.laneId === laneId)?.path ??
		join(run.worktree.runDir, `lane-${String(laneId).padStart(3, "0")}`);
	mkdirSync(laneDir, { recursive: true });
	const summaryPath = join(laneDir, "summary.md");
	writeFileSync(summaryPath, content, "utf8");
	return summaryPath;
}

export function createFleetRun(plan: FleetPlan, projectRoot: string): FleetRun {
	const now = new Date().toISOString();
	const status: FleetRunStatus =
		plan.mode === "dry-run" ? "done" : plan.policy.canExecute ? "queued" : "blocked";
	const worktree = createWorktreePlan(plan, projectRoot);
	const run: FleetRun = {
		id: plan.id,
		status,
		createdAt: now,
		updatedAt: now,
		task: plan.task,
		plan,
		worktree,
		merge: createMergeManifest(plan),
		prompts: plan.lanes.map((lane) => workerPrompt(plan, lane)),
		lanes: plan.lanes.map((lane) => laneRun(plan, lane)),
		events: [
			`created ${now}`,
			status === "done"
				? "dry-run manifest generated; no provider calls made"
				: status === "queued"
					? "run queued"
					: "run blocked by policy",
		],
	};
	const manifestPath = writeRunManifest(run);
	return { ...run, manifestPath };
}

function runnableReadOnlyPrompt(run: FleetRun): FleetWorkerPrompt | undefined {
	const executeLane = run.plan.policy.executeLane;
	return run.prompts.find(
		(prompt) =>
			prompt.laneId === executeLane &&
			prompt.allowedTools.length === 1 &&
			prompt.allowedTools[0] === "read",
	);
}

export async function executeReadOnlyFleetRun(
	run: FleetRun,
	client: FleetChatClient,
): Promise<FleetRun> {
	const now = new Date().toISOString();
	if (!run.plan.policy.canExecute || run.plan.policy.executor !== "single-readonly") {
		const blocked = {
			...run,
			status: "blocked" as FleetRunStatus,
			updatedAt: now,
			events: [...run.events, `execution refused ${now}`],
		};
		writeRunManifest(blocked);
		return blocked;
	}
	const prompt = runnableReadOnlyPrompt(run);
	if (!prompt) {
		const failed = {
			...run,
			status: "failed" as FleetRunStatus,
			updatedAt: now,
			events: [...run.events, `failed ${now}: no read-only prompt available`],
		};
		writeRunManifest(failed);
		return failed;
	}
	const running: FleetRun = {
		...run,
		status: "running",
		updatedAt: now,
		lanes: run.lanes.map((lane) =>
			lane.laneId === prompt.laneId
				? { ...lane, state: "running", startedAt: now, exitReason: undefined }
				: lane,
		),
		events: [...run.events, `started lane ${prompt.laneId} ${now}`],
	};
	writeRunManifest(running);
	try {
		const response = await client.chat(
			[
				{ role: "system", content: prompt.system },
				{ role: "user", content: prompt.user },
			],
			prompt.model,
		);
		const finishedAt = new Date().toISOString();
		const summaryPath = writeLaneSummary(
			running,
			prompt.laneId,
			[
				`# Fleet lane ${prompt.laneId}`,
				"",
				`Model: ${response.model || prompt.model}`,
				`Cost: ${money(response.costUsd)}`,
				`Saved: ${money(response.savedUsd)}`,
				`Latency: ${numberShort(response.latencyMs)}ms`,
				"",
				response.content,
				"",
			].join("\n"),
		);
		const done: FleetRun = {
			...running,
			status: "done",
			updatedAt: finishedAt,
			lanes: running.lanes.map((lane) =>
				lane.laneId === prompt.laneId
					? {
							...lane,
							state: "done",
							finishedAt,
							summaryPath,
							actualModel: response.model || prompt.model,
							actualCostUsd: response.costUsd,
							actualSavedUsd: response.savedUsd,
							latencyMs: response.latencyMs,
						}
					: lane,
			),
			events: [
				...running.events,
				`finished lane ${prompt.laneId} ${finishedAt} cost ${money(response.costUsd)}`,
			],
		};
		writeRunManifest(done);
		return done;
	} catch (error) {
		const failedAt = new Date().toISOString();
		const message = error instanceof Error ? error.message : "read-only executor failed";
		const failed: FleetRun = {
			...running,
			status: "failed",
			updatedAt: failedAt,
			lanes: running.lanes.map((lane) =>
				lane.laneId === prompt.laneId
					? {
							...lane,
							state: "failed",
							finishedAt: failedAt,
							exitReason: message,
						}
					: lane,
			),
			events: [...running.events, `failed lane ${prompt.laneId} ${failedAt}: ${message}`],
		};
		writeRunManifest(failed);
		return failed;
	}
}

export function cancelFleetRun(run: FleetRun | null): FleetRun {
	const now = new Date().toISOString();
	if (!run) {
		return {
			id: "fleet-cancel",
			status: "cancelled",
			createdAt: now,
			updatedAt: now,
			task: "Cancel active fleet run",
			plan: {
				id: "fleet-cancel",
				requestedAgents: 0,
				agents: 0,
				concurrency: 0,
				task: "Cancel active fleet run",
				mode: "cancel",
				state: "blocked",
				lanes: [],
				providerPool: [],
				policy: {
					canExecute: false,
					budgetState: "ok",
					budgetUsd: 0,
					remainingDailyBudgetUsd: null,
					estimatedCostUsd: 0,
					isolation: "read-only",
					merge: "summary-only",
					cancellation: "available",
					executor: "none",
					executeLane: null,
					blockers: ["No active fleet run exists in this TUI session."],
				},
				warnings: ["No active fleet run exists in this TUI session."],
			},
			worktree: {
				strategy: "read-only",
				runDir: "",
				workspaceMode: "shared-readonly",
				laneDirs: [],
				blockers: [],
			},
			merge: {
				strategy: "summary-only",
				canAutoApply: false,
				conflictPolicy: "No active run.",
				expectedOutputs: [],
				protectedScopes: [],
			},
			prompts: [],
			lanes: [],
			events: [`cancel requested ${now}`, "no active run"],
		};
	}
	return {
		...run,
		status: "cancelled",
		updatedAt: now,
		lanes: run.lanes.map((lane) =>
			lane.state === "done" || lane.state === "failed"
				? lane
				: {
						...lane,
						state: "blocked",
						finishedAt: now,
						exitReason: "Cancelled by user.",
					},
		),
		events: [...run.events, `cancelled ${now}`],
	};
}

export function renderFleetRun(run: FleetRun): string {
	return [
		"Fleet Run",
		`Run id: ${run.id}`,
		`Status: ${run.status}`,
		`Task: ${run.task}`,
		`Manifest: ${run.manifestPath ?? "not written"}`,
		`Prompts: ${numberShort(run.prompts.length)}`,
		`Lanes: ${numberShort(run.lanes.length)}`,
		`Estimated cost: ${money(run.plan.policy.estimatedCostUsd)}`,
		`Executor: ${run.plan.policy.executor}`,
		`Isolation: ${run.worktree.strategy} (${run.worktree.workspaceMode})`,
		`Merge: ${run.merge.strategy} auto-apply ${run.merge.canAutoApply ? "on" : "off"}`,
		"",
		"Events",
		...run.events.slice(-8).map((event) => `- ${event}`),
		"",
		"Execution blockers",
		...run.plan.policy.blockers.map((blocker) => `- ${blocker}`),
		...run.worktree.blockers.map((blocker) => `- ${blocker}`),
		"",
		"Worker prompts",
		...run.prompts.slice(0, 8).map(
			(prompt) =>
				`${String(prompt.laneId).padStart(3)}  ${prompt.provider.padEnd(10)} ${prompt.model.padEnd(30)} ${prompt.allowedTools.join(",")}`,
		),
		run.prompts.length > 8 ? `... ${run.prompts.length - 8} more prompts` : "",
		"",
		"Merge manifest",
		`Conflict policy: ${run.merge.conflictPolicy}`,
		...run.merge.expectedOutputs.slice(0, 8).map(
			(output) => `- lane ${output.laneId} ${output.kind}: ${output.path}`,
		),
		run.merge.expectedOutputs.length > 8
			? `... ${run.merge.expectedOutputs.length - 8} more outputs`
			: "",
	]
		.filter(Boolean)
		.join("\n");
}
