// Benchmark runner — what does the Guardian pipeline cost and what does it keep?
//
// Public "harness" comparisons (SWE-bench, Terminal-Bench, ...) hold the model
// fixed and score the scaffolding around it. Guardian is not an agent loop: it
// is the prompt-optimization layer in front of a model. So the honest
// questions are the ones it actually controls:
//
//   1. How many tokens does it remove? (cost)
//   2. Do the facts the answer depends on survive? (fidelity)
//   3. How long does it take? (overhead)
//   4. Is it better than dumb alternatives at the SAME token budget?
//
// (4) matters most. "We shrank the prompt 60%" is meaningless if cutting the
// prompt to its last 60% of tokens keeps the same facts. So each scenario is
// run through four arms, and the baselines are held to Guardian's budget:
//
//   raw       the conversation untouched
//   minify    whitespace/duplicate-line cleanup only (no budget)
//   window    sliding window at Guardian's budget: system + most recent turns,
//             the oldest kept turn truncated to fit — what a naive harness does
//   guardian  the real pipeline the chat TUI runs (`optimize`)
//
// This measures prompt-side behavior only. Whether a MODEL still answers
// correctly needs a live model: use `bun run bench:quality`.

import { optimize } from "../cli/chat-session.ts";
import { clearFoldCache } from "../core/folding-engine.ts";
import { estimateTokens } from "../core/token-counter.ts";
import type { ChatMessage } from "../core/types.ts";
import { type Scenario, buildCorpus } from "./corpus.ts";

export type ArmName = "raw" | "minify" | "window" | "guardian";

export type ArmResult = {
	tokens: number;
	/** Fraction of needles still present, 0–1. */
	retention: number;
	dropped: string[];
};

export type ScenarioResult = {
	name: string;
	description: string;
	control: boolean;
	hard: boolean;
	/** Seeded variants averaged into this row. */
	variants: number;
	arms: Record<ArmName, ArmResult>;
	stages: { extracted: boolean; folded: boolean; sharded: boolean };
	latencyMs: { p50: number; p95: number };
};

export type BenchReport = {
	generatedAt: string;
	tokenizer: string;
	iterations: number;
	scenarios: ScenarioResult[];
	summary: {
		/** Mean token reduction over the non-control scenarios, 0–1. */
		meanReduction: number;
		/** Mean needle retention, guardian vs equal-budget window. */
		guardianRetention: number;
		windowRetention: number;
		/** Same, over the deliberately adversarial scenarios only. */
		hardRetention: number;
		/** Scenarios where guardian dropped at least one needle. */
		scenariosWithLoss: string[];
		worstP95Ms: number;
	};
};

const text = (ms: readonly ChatMessage[]) => ms.map((m) => m.content).join("\n\n");
const tokens = (ms: readonly ChatMessage[]) =>
	ms.reduce((s, m) => s + estimateTokens(m.content), 0);

function score(ms: readonly ChatMessage[], needles: string[]): ArmResult {
	const hay = text(ms).toLowerCase();
	const dropped = needles.filter((n) => !hay.includes(n.toLowerCase()));
	return {
		tokens: tokens(ms),
		retention: (needles.length - dropped.length) / needles.length,
		dropped,
	};
}

/** Cheap, safe cleanup: trim lines, drop blanks and consecutive duplicates. */
function minify(ms: readonly ChatMessage[]): ChatMessage[] {
	return ms.map((m) => {
		const out: string[] = [];
		for (const raw of m.content.split("\n")) {
			const line = raw.replace(/[ \t]+/g, " ").trim();
			if (line && line !== out[out.length - 1]) out.push(line);
		}
		return { ...m, content: out.join("\n") };
	});
}

/** Keep the END of `s` within `budget` tokens (binary search on length). */
function tailWithin(s: string, budget: number): string {
	if (budget <= 0) return "";
	if (estimateTokens(s) <= budget) return s;
	let lo = 0;
	let hi = s.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (estimateTokens(s.slice(s.length - mid)) <= budget) lo = mid;
		else hi = mid - 1;
	}
	return s.slice(s.length - lo);
}

/** Sliding window: system + newest turns that fit; the boundary turn is cut. */
function windowTo(ms: readonly ChatMessage[], budget: number): ChatMessage[] {
	const system = ms.filter((m) => m.role === "system");
	const rest = ms.filter((m) => m.role !== "system");
	let room = budget - tokens(system);
	const kept: ChatMessage[] = [];
	for (let i = rest.length - 1; i >= 0 && room > 0; i--) {
		const m = rest[i] as ChatMessage;
		const cost = estimateTokens(m.content);
		if (cost <= room) {
			kept.unshift(m);
			room -= cost;
		} else {
			kept.unshift({ ...m, content: tailWithin(m.content, room) });
			room = 0;
		}
	}
	return [...system, ...kept];
}

function percentile(sorted: number[], p: number): number {
	if (!sorted.length) return 0;
	return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number;
}

function runScenario(s: Scenario, iterations: number): ScenarioResult {
	// Warm up (JIT, regex caches), then time cold folds — the fold cache would
	// otherwise turn every repeat into a hash lookup.
	for (let i = 0; i < 2; i++) {
		clearFoldCache();
		optimize(s.messages);
	}
	const samples: number[] = [];
	let last = optimize(s.messages);
	for (let i = 0; i < iterations; i++) {
		clearFoldCache();
		const t0 = performance.now();
		last = optimize(s.messages);
		samples.push(performance.now() - t0);
	}
	samples.sort((a, b) => a - b);

	const guardianTokens = tokens(last.messages);
	return {
		name: s.name,
		description: s.description,
		control: !!s.control,
		hard: !!s.hard,
		variants: 1,
		arms: {
			raw: score(s.messages, s.needles),
			minify: score(minify(s.messages), s.needles),
			window: score(windowTo(s.messages, guardianTokens), s.needles),
			guardian: score(last.messages, s.needles),
		},
		stages: { extracted: last.extracted, folded: last.folded, sharded: last.sharded },
		latencyMs: { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95) },
	};
}

/** Average one scenario's seeded variants into a single row. */
function mergeVariants(rs: ScenarioResult[]): ScenarioResult {
	const first = rs[0] as ScenarioResult;
	const mean = (f: (r: ScenarioResult) => number) => rs.reduce((s, r) => s + f(r), 0) / rs.length;
	const arm = (a: ArmName): ArmResult => ({
		tokens: Math.round(mean((r) => r.arms[a].tokens)),
		retention: mean((r) => r.arms[a].retention),
		dropped: [...new Set(rs.flatMap((r) => r.arms[a].dropped))],
	});
	return {
		...first,
		variants: rs.length,
		arms: { raw: arm("raw"), minify: arm("minify"), window: arm("window"), guardian: arm("guardian") },
		stages: {
			extracted: rs.some((r) => r.stages.extracted),
			folded: rs.some((r) => r.stages.folded),
			sharded: rs.some((r) => r.stages.sharded),
		},
		latencyMs: {
			p50: mean((r) => r.latencyMs.p50),
			p95: Math.max(...rs.map((r) => r.latencyMs.p95)),
		},
	};
}

export function runBenchmark(opts: { iterations?: number; variants?: number } = {}): BenchReport {
	const iterations = opts.iterations ?? 10;
	const byName = new Map<string, ScenarioResult[]>();
	for (const s of buildCorpus(opts.variants)) {
		const list = byName.get(s.name) ?? [];
		list.push(runScenario(s, iterations));
		byName.set(s.name, list);
	}
	const scenarios = [...byName.values()].map(mergeVariants);
	const real = scenarios.filter((s) => !s.control && !s.hard);
	const hard = scenarios.filter((s) => s.hard);
	const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

	return {
		generatedAt: new Date().toISOString(),
		tokenizer: "built-in BPE estimate (~±10% of tiktoken)",
		iterations,
		scenarios,
		summary: {
			meanReduction: mean(
				real.map((s) => 1 - s.arms.guardian.tokens / Math.max(1, s.arms.raw.tokens)),
			),
			guardianRetention: mean(
				scenarios.filter((s) => !s.hard).map((s) => s.arms.guardian.retention),
			),
			windowRetention: mean(
				scenarios.filter((s) => !s.hard).map((s) => s.arms.window.retention),
			),
			hardRetention: mean(hard.map((s) => s.arms.guardian.retention)),
			scenariosWithLoss: scenarios
				.filter((s) => s.arms.guardian.retention < 1)
				.map((s) => s.name),
			worstP95Ms: Math.max(...scenarios.map((s) => s.latencyMs.p95)),
		},
	};
}

// ─── Rendering ───────────────────────────────────────────────────────────────

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

/** Plain-text report lines (no color), used by the script and the CLI alike. */
export function formatReport(r: BenchReport): string[] {
	const out: string[] = [];
	const head = [
		"scenario".padEnd(15),
		"raw tok".padStart(8),
		"guardian".padStart(9),
		"saved".padStart(6),
		"kept: guardian".padStart(15),
		"window*".padStart(8),
		"p95 ms".padStart(7),
		"stages",
	].join("  ");
	out.push(head, "-".repeat(head.length));
	for (const s of r.scenarios) {
		const saved = 1 - s.arms.guardian.tokens / Math.max(1, s.arms.raw.tokens);
		const stages = [
			s.stages.extracted ? "extract" : "",
			s.stages.folded ? "fold" : "",
			s.stages.sharded ? "shard" : "",
		]
			.filter(Boolean)
			.join("+");
		out.push(
			[
				(s.hard ? `${s.name}†` : s.name).padEnd(15),
				String(s.arms.raw.tokens).padStart(8),
				String(s.arms.guardian.tokens).padStart(9),
				pct(Math.max(0, saved)).padStart(6),
				pct(s.arms.guardian.retention).padStart(15),
				pct(s.arms.window.retention).padStart(8),
				s.latencyMs.p95.toFixed(2).padStart(7),
				stages || "—",
			].join("  "),
		);
		if (s.arms.guardian.dropped.length) {
			out.push(`  lost: ${s.arms.guardian.dropped.join(", ")}`);
		}
	}
	out.push("", "* window = sliding window cut to Guardian's token budget (equal-budget baseline)");
	out.push("† adversarial: question has no lexical link to the answer (reported separately)");
	out.push(
		"",
		`mean token reduction (non-control) : ${pct(r.summary.meanReduction, 1)}`,
		`fact retention  guardian            : ${pct(r.summary.guardianRetention, 1)}`,
		`fact retention  equal-budget window : ${pct(r.summary.windowRetention, 1)}`,
		`fact retention  adversarial cases   : ${pct(r.summary.hardRetention, 1)}`,
		`worst p95 overhead                  : ${r.summary.worstP95Ms.toFixed(2)} ms`,
		`tokenizer                           : ${r.tokenizer}`,
	);
	return out;
}
