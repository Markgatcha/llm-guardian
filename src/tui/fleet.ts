import { money, numberShort } from "./format.ts";
import type { GuardianSnapshot } from "./types.ts";

export type FleetState =
	| "idle"
	| "planning"
	| "queued"
	| "running"
	| "blocked"
	| "done"
	| "failed"
	| "merging";
export type FleetMode = "idle" | "plan" | "dry-run" | "run" | "cancel";
export type FleetBudgetState = "ok" | "warning" | "blocked";
export type FleetIsolationStrategy =
	| "read-only"
	| "sandbox-required"
	| "worktree-required";
export type FleetMergeStrategy = "summary-only" | "patch-review" | "blocked";

export interface FleetProviderSlot {
	provider: string;
	model: string;
	role: string;
	contextWindow: number;
	inputPerMillion: number;
	outputPerMillion: number;
	supportsTools: boolean;
	supportsVision: boolean;
	estimatedConcurrency: number;
}

export interface FleetLane {
	id: number;
	state: FleetState;
	role: string;
	focus: string;
	modelHint: string;
	toolLimit: string;
	provider: string;
	model: string;
	dependsOn: number[];
	fileScope: string;
	estimatedInputTokens: number;
	estimatedOutputTokens: number;
	estimatedCostUsd: number;
}

export interface FleetPolicy {
	canExecute: boolean;
	budgetState: FleetBudgetState;
	budgetUsd: number;
	remainingDailyBudgetUsd: number | null;
	estimatedCostUsd: number;
	isolation: FleetIsolationStrategy;
	merge: FleetMergeStrategy;
	cancellation: "planned" | "available";
	executor: "none" | "single-readonly";
	executeLane: number | null;
	blockers: string[];
}

export interface FleetPlan {
	id: string;
	requestedAgents: number;
	agents: number;
	concurrency: number;
	task: string;
	mode: FleetMode;
	state: FleetState;
	lanes: FleetLane[];
	providerPool: FleetProviderSlot[];
	policy: FleetPolicy;
	warnings: string[];
}

const MAX_PLANNED_AGENTS = 300;
const DEFAULT_CONCURRENCY = 6;
const MIN_CONCURRENCY = 1;
const MAX_SAFE_CONCURRENCY = 8;
const DEFAULT_RUN_BUDGET_USD = 1;
const DEFAULT_INPUT_TOKENS_PER_LANE = 18_000;
const DEFAULT_OUTPUT_TOKENS_PER_LANE = 4_000;

const FALLBACK_PROVIDER_POOL: FleetProviderSlot[] = [
	{
		provider: "openrouter",
		model: "auto",
		role: "provider fallback",
		contextWindow: 128_000,
		inputPerMillion: 2,
		outputPerMillion: 8,
		supportsTools: true,
		supportsVision: false,
		estimatedConcurrency: 2,
	},
];

function readNumberFlag(input: string[], names: string[]): number | undefined {
	const index = input.findIndex((item) => names.includes(item));
	if (index < 0) return undefined;
	const parsed = Number(input[index + 1]);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function readStringFlag(input: string[], names: string[]): string | undefined {
	const index = input.findIndex((item) => names.includes(item));
	if (index < 0) return undefined;
	const value = input[index + 1];
	return value && !value.startsWith("--") ? value : undefined;
}

function stripFlags(input: string[]): string[] {
	const result: string[] = [];
	for (let index = 0; index < input.length; index++) {
		const item = input[index];
		if (
			[
				"--agents",
				"-n",
				"--max",
				"--budget",
				"--provider",
				"--model",
				"--execute-lane",
			].includes(item)
		) {
			index++;
			continue;
		}
		if (["--dry-run", "--run", "--plan", "--execute-readonly"].includes(item)) {
			continue;
		}
		result.push(item);
	}
	return result;
}

function parseFleetArgs(input: string[]): {
	agents: number;
	concurrency: number;
	task: string;
	dryRun: boolean;
	runRequested: boolean;
	executeReadOnly: boolean;
	executeLane: number;
	cancelRequested: boolean;
	budgetUsd: number;
	providerHint?: string;
	modelHint?: string;
} {
	const cancelRequested = input[0]?.toLowerCase() === "cancel";
	const explicitAgents = readNumberFlag(input, ["--agents", "-n"]);
	const explicitMax = readNumberFlag(input, ["--max"]);
	const explicitBudget = readNumberFlag(input, ["--budget"]);
	const explicitExecuteLane = readNumberFlag(input, ["--execute-lane"]);
	const providerHint = readStringFlag(input, ["--provider"]);
	const modelHint = readStringFlag(input, ["--model"]);
	const stripped = stripFlags(input);
	const first = Number(stripped[0]);
	const wantsSingleReadOnly = input.includes("--execute-readonly");
	const agents = Number.isFinite(explicitAgents)
		? (explicitAgents as number)
		: Number.isFinite(first)
			? first
			: wantsSingleReadOnly
				? 1
				: DEFAULT_CONCURRENCY;
	const concurrencySource = Number.isFinite(explicitMax)
		? (explicitMax as number)
		: Math.min(agents, DEFAULT_CONCURRENCY);
	const task = Number.isFinite(first) ? stripped.slice(1).join(" ") : stripped.join(" ");
	return {
		agents: Math.max(1, Math.floor(agents)),
		concurrency: Math.max(MIN_CONCURRENCY, Math.floor(concurrencySource)),
		task: task.trim(),
		dryRun: input.includes("--dry-run"),
		runRequested: input.includes("--run"),
		executeReadOnly: input.includes("--execute-readonly"),
		executeLane:
			Number.isFinite(explicitExecuteLane) && explicitExecuteLane !== undefined
				? Math.max(1, Math.floor(explicitExecuteLane))
				: 1,
		cancelRequested,
		budgetUsd:
			Number.isFinite(explicitBudget) && explicitBudget !== undefined
				? Math.max(0, explicitBudget)
				: DEFAULT_RUN_BUDGET_USD,
		providerHint,
		modelHint,
	};
}

function planId(task: string): string {
	let hash = 0;
	for (const char of task) {
		hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	}
	return `fleet-${hash.toString(16).padStart(8, "0").slice(0, 8)}`;
}

function chooseProviderPool(
	snapshot: GuardianSnapshot,
	providerHint?: string,
	modelHint?: string,
): FleetProviderSlot[] {
	const candidates = snapshot.providers
		.filter((model) => {
			if (providerHint && model.provider !== providerHint) return false;
			if (modelHint && model.model !== modelHint) return false;
			return true;
		})
		.filter((model) => model.model && model.inputPerMillion >= 0)
		.sort((a, b) => {
			const toolScore =
				Number(Boolean(b.supportsTools)) - Number(Boolean(a.supportsTools));
			if (toolScore !== 0) return toolScore;
			const contextA = Number.isFinite(a.contextWindow) ? a.contextWindow ?? 0 : 0;
			const contextB = Number.isFinite(b.contextWindow) ? b.contextWindow ?? 0 : 0;
			if (contextA !== contextB) return contextB - contextA;
			const costA = a.inputPerMillion + a.outputPerMillion;
			const costB = b.inputPerMillion + b.outputPerMillion;
			return costA - costB;
		})
		.slice(0, 8)
		.map((model, index) => ({
			provider: model.provider || "openrouter",
			model: model.model,
			role:
				index === 0
					? "lead reasoning"
					: index === 1
						? "long context"
						: index === 2
							? "cheap worker"
							: "fallback worker",
			contextWindow: Number.isFinite(model.contextWindow)
				? model.contextWindow ?? 0
				: 0,
			inputPerMillion: model.inputPerMillion,
			outputPerMillion: model.outputPerMillion,
			supportsTools: Boolean(model.supportsTools),
			supportsVision: Boolean(model.supportsVision),
			estimatedConcurrency: index < 2 ? 2 : 1,
		}));
	return candidates.length > 0 ? candidates : FALLBACK_PROVIDER_POOL;
}

function estimateLaneCost(
	slot: FleetProviderSlot,
	inputTokens = DEFAULT_INPUT_TOKENS_PER_LANE,
	outputTokens = DEFAULT_OUTPUT_TOKENS_PER_LANE,
): number {
	return (
		(inputTokens / 1_000_000) * slot.inputPerMillion +
		(outputTokens / 1_000_000) * slot.outputPerMillion
	);
}

function remainingDailyBudget(snapshot: GuardianSnapshot): number | null {
	if (snapshot.budget.dailyLimitUsd <= 0) return null;
	return Math.max(0, snapshot.budget.dailyLimitUsd - snapshot.budget.dailySpentUsd);
}

function buildFleetPolicy(input: {
	mode: FleetMode;
	runRequested: boolean;
	budgetUsd: number;
	estimatedCostUsd: number;
	remainingDailyBudgetUsd: number | null;
	hasProviderPool: boolean;
	executeReadOnly: boolean;
	executeLane: number;
	readOnlyLaneIds: number[];
}): FleetPolicy {
	const canUseReadOnlyExecutor =
		input.mode === "run" &&
		input.runRequested &&
		input.executeReadOnly &&
		input.readOnlyLaneIds.includes(input.executeLane);
	const blockers: string[] = [];
	if (!canUseReadOnlyExecutor) {
		blockers.push("Provider pool execution adapters are not wired yet.");
	}
	if (input.mode === "run" && input.runRequested && !input.executeReadOnly) {
		blockers.push("Add --execute-readonly to opt in to the first safe executor.");
	}
	if (input.mode === "run" && input.executeReadOnly && !input.readOnlyLaneIds.includes(input.executeLane)) {
		blockers.push(`Lane ${input.executeLane} is not read-only and cannot use the safe executor.`);
	}
	if (!canUseReadOnlyExecutor || input.mode !== "run") {
		blockers.push("Per-worker sandbox/worktree creation is not wired yet.");
	}
	blockers.push("Patch merge and conflict resolution are not wired yet.");
	blockers.push("Cancellation tokens are designed but not connected to running workers yet.");
	if (!input.hasProviderPool) {
		blockers.unshift("No live provider catalog is available.");
	}
	if (
		input.remainingDailyBudgetUsd !== null &&
		input.estimatedCostUsd > input.remainingDailyBudgetUsd
	) {
		blockers.unshift("Estimated run cost exceeds remaining daily budget.");
	}
	if (input.estimatedCostUsd > input.budgetUsd) {
		blockers.unshift("Estimated run cost exceeds fleet run budget.");
	}
	const hasBudgetBlocker = blockers.some((item) => item.includes("budget"));
	const budgetState: FleetBudgetState =
		hasBudgetBlocker
			? "blocked"
			: input.estimatedCostUsd > input.budgetUsd * 0.8
				? "warning"
				: "ok";
	return {
		canExecute: canUseReadOnlyExecutor && !hasBudgetBlocker,
		budgetState,
		budgetUsd: input.budgetUsd,
		remainingDailyBudgetUsd: input.remainingDailyBudgetUsd,
		estimatedCostUsd: input.estimatedCostUsd,
		isolation:
			input.mode === "dry-run" || canUseReadOnlyExecutor
				? "read-only"
				: "worktree-required",
		merge:
			input.mode === "dry-run" || canUseReadOnlyExecutor
				? "summary-only"
				: "patch-review",
		cancellation: canUseReadOnlyExecutor ? "available" : "planned",
		executor: canUseReadOnlyExecutor ? "single-readonly" : "none",
		executeLane: canUseReadOnlyExecutor ? input.executeLane : null,
		blockers,
	};
}

export function createFleetPlan(
	args: string[],
	snapshot: GuardianSnapshot,
): FleetPlan {
	if (args.length === 0) {
		const policy = buildFleetPolicy({
			mode: "idle",
			runRequested: false,
			budgetUsd: DEFAULT_RUN_BUDGET_USD,
			estimatedCostUsd: 0,
			remainingDailyBudgetUsd: remainingDailyBudget(snapshot),
			hasProviderPool: snapshot.providers.length > 0,
			executeReadOnly: false,
			executeLane: 1,
			readOnlyLaneIds: [],
		});
		return {
			id: "fleet-idle",
			requestedAgents: 0,
			agents: 0,
			concurrency: 0,
			task: "",
			mode: "idle",
			state: "idle",
			lanes: [],
			providerPool: [],
			policy,
			warnings: [
				"Use /fleet --dry-run <task> to preview a task graph.",
				"Use /fleet --max 4 <task> to cap planned concurrency.",
				"Use /fleet --run <task> after execution adapters, sandboxes, cancellation, and merge controls are implemented.",
			],
		};
	}

	const parsed = parseFleetArgs(args);
	if (parsed.cancelRequested) {
		const policy = buildFleetPolicy({
			mode: "cancel",
			runRequested: false,
			budgetUsd: parsed.budgetUsd,
			estimatedCostUsd: 0,
			remainingDailyBudgetUsd: remainingDailyBudget(snapshot),
			hasProviderPool: snapshot.providers.length > 0,
			executeReadOnly: false,
			executeLane: 1,
			readOnlyLaneIds: [],
		});
		return {
			id: "fleet-cancel",
			requestedAgents: 0,
			agents: 0,
			concurrency: 0,
			task: "Cancel active fleet run",
			mode: "cancel",
			state: "blocked",
			lanes: [],
			providerPool: chooseProviderPool(snapshot, parsed.providerHint, parsed.modelHint),
			policy: {
				...policy,
				blockers: [
					"No active fleet run exists in this TUI session.",
					"Cancellation will become active when worker execution is wired.",
				],
			},
			warnings: ["Fleet cancellation requested, but there is no active run."],
		};
	}
	const requested = parsed.agents;
	const agents = Math.min(requested, MAX_PLANNED_AGENTS);
	const concurrency = Math.min(parsed.concurrency, MAX_SAFE_CONCURRENCY, agents);
	const mode: FleetMode = parsed.dryRun
		? "dry-run"
		: parsed.runRequested
			? "run"
			: "plan";
	const task =
		parsed.task ||
		"Break down this repository into independent implementation and review work.";
	const providerPool = chooseProviderPool(
		snapshot,
		parsed.providerHint,
		parsed.modelHint,
	);
	const roles = [
		"planner",
		"context scout",
		"code worker",
		"test worker",
		"reviewer",
		"cost auditor",
		"merge lead",
		"risk analyst",
	];
	const lanes = Array.from({ length: Math.min(agents, 24) }, (_, index) => {
		const slot = providerPool[index % providerPool.length] ?? FALLBACK_PROVIDER_POOL[0];
		const estimatedInputTokens =
			DEFAULT_INPUT_TOKENS_PER_LANE + (index % 4) * 1500;
		const estimatedOutputTokens =
			DEFAULT_OUTPUT_TOKENS_PER_LANE + (index % 3) * 700;
		return {
		id: index + 1,
		state: (index < concurrency ? "queued" : "blocked") as FleetState,
		role: roles[index % roles.length],
		focus:
			index % 8 === 0
				? "task graph and dependency ordering"
				: index % 8 === 1
					? "repo context and relevant file map"
					: index % 8 === 2
						? "bounded implementation slice"
						: index % 8 === 3
							? "tests, smoke checks, and fixtures"
							: index % 8 === 4
								? "risk review and regression scan"
								: index % 8 === 5
									? "cost, token, and budget impact"
									: index % 8 === 6
										? "merge strategy and conflict detection"
										: "failure modes and rollback notes",
		modelHint:
			slot.role,
		toolLimit:
			index % 3 === 0
				? "read-only"
				: index % 3 === 1
					? "tests allowed"
					: "patch proposal",
		provider: slot.provider,
		model: slot.model,
		dependsOn: index === 0 ? [] : index < concurrency ? [1] : [Math.max(1, index)],
		fileScope:
			index % 5 === 0
				? "planning only"
				: index % 5 === 1
					? "src/**/*.ts"
					: index % 5 === 2
						? "tests/**/*.ts"
						: index % 5 === 3
							? ".guardian/**"
							: "review output",
		estimatedInputTokens,
		estimatedOutputTokens,
		estimatedCostUsd: estimateLaneCost(
			slot,
			estimatedInputTokens,
			estimatedOutputTokens,
		),
	};
	});
	const estimatedCostUsd =
		lanes.reduce((sum, lane) => sum + lane.estimatedCostUsd, 0) +
		Math.max(0, agents - lanes.length) *
			estimateLaneCost(providerPool[0] ?? FALLBACK_PROVIDER_POOL[0]);
	const readOnlyLaneIds = lanes
		.filter((lane) => lane.toolLimit === "read-only")
		.map((lane) => lane.id);
	const policy = buildFleetPolicy({
		mode,
		runRequested: parsed.runRequested,
		budgetUsd: parsed.budgetUsd,
		estimatedCostUsd,
		remainingDailyBudgetUsd: remainingDailyBudget(snapshot),
		hasProviderPool: snapshot.providers.length > 0,
		executeReadOnly: parsed.executeReadOnly,
		executeLane: parsed.executeLane,
		readOnlyLaneIds,
	});
	const warnings = [
		mode === "dry-run"
			? "Dry-run only: no provider calls, shell commands, or file edits will run."
			: parsed.runRequested
				? policy.canExecute
					? `Run requested: executing one read-only lane ${policy.executeLane}; no shell tools or patches are allowed.`
					: "Run requested, but execution is blocked until a safe executor is selected and policy checks pass."
				: "Plan only: real subagent execution is not enabled in this pass.",
		requested > MAX_PLANNED_AGENTS
			? `Requested ${requested}; capped at ${MAX_PLANNED_AGENTS}.`
			: "",
		parsed.concurrency > MAX_SAFE_CONCURRENCY
			? `Requested concurrency ${parsed.concurrency}; capped at ${MAX_SAFE_CONCURRENCY}.`
			: "",
		`Planned concurrency: ${concurrency}. Default real execution target remains 4-8 workers.`,
		`Estimated run cost: ${money(estimatedCostUsd)} against fleet budget ${money(parsed.budgetUsd)}.`,
		`Isolation strategy: ${policy.isolation}. Merge strategy: ${policy.merge}.`,
		policy.executor === "single-readonly"
			? "Executor: single read-only provider call. Patch-producing lanes remain blocked."
			: "",
		snapshot.budget.dailyLimitUsd > 0
			? `Daily budget: ${money(snapshot.budget.dailySpentUsd)} / ${money(snapshot.budget.dailyLimitUsd)}.`
			: "Daily budget is not configured.",
	].filter(Boolean);
	return {
		id: planId(task),
		requestedAgents: requested,
		agents,
		concurrency,
		task,
		mode,
		state: parsed.runRequested ? (policy.canExecute ? "queued" : "blocked") : "planning",
		lanes,
		providerPool,
		policy,
		warnings,
	};
}

export function renderFleetPlan(plan: FleetPlan): string {
	if (plan.mode === "idle") {
		return [
			"Fleet",
			"State: idle",
			"Execution: disabled",
			"",
			...plan.warnings.map((warning) => `- ${warning}`),
		].join("\n");
	}

	return [
		"Fleet",
		`Run id: ${plan.id}`,
		`State: ${plan.state}`,
		`Mode: ${plan.mode}`,
		`Agents: ${numberShort(plan.agents)} requested ${numberShort(plan.requestedAgents)}`,
		`Concurrency: ${numberShort(plan.concurrency)}`,
		`Execution: ${plan.policy.canExecute ? "ready" : "blocked"}`,
		`Executor: ${plan.policy.executor}`,
		`Execute lane: ${plan.policy.executeLane ?? "none"}`,
		`Budget: ${money(plan.policy.estimatedCostUsd)} est / ${money(plan.policy.budgetUsd)} cap (${plan.policy.budgetState})`,
		`Isolation: ${plan.policy.isolation}`,
		`Merge: ${plan.policy.merge}`,
		`Task: ${plan.task}`,
		"",
		"Provider pool",
		...plan.providerPool.slice(0, 6).map(
			(slot) =>
				`${slot.provider.padEnd(12)} ${slot.model.padEnd(34)} ctx ${numberShort(slot.contextWindow).padStart(7)} ${money(slot.inputPerMillion)}/${money(slot.outputPerMillion)} per 1M ${slot.supportsTools ? "tools" : "no-tools"}`,
		),
		"",
		"Warnings",
		...plan.warnings.map((warning) => `- ${warning}`),
		"",
		"Blockers",
		...plan.policy.blockers.map((blocker) => `- ${blocker}`),
		"",
		"Task graph",
		...plan.lanes.map(
			(lane) =>
				`${String(lane.id).padStart(3)}  ${lane.state.padEnd(8)} ${lane.role.padEnd(13)} ${lane.provider.padEnd(10)} ${lane.toolLimit.padEnd(14)} ${money(lane.estimatedCostUsd).padStart(7)} ${lane.focus}`,
		),
		plan.agents > plan.lanes.length
			? `... ${plan.agents - plan.lanes.length} more planned lanes`
			: "",
		"",
		"Next: implement provider pools for OpenRouter, Claude, ChatGPT, Gemini, and local models before enabling real execution.",
	]
		.filter(Boolean)
		.join("\n");
}
