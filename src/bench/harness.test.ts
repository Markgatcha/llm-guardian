// Benchmark harness tests.
//
// These lock the properties the benchmark exists to protect. The adversarial
// scenarios (no lexical link between question and answer) are deliberately NOT
// asserted: they are expected to fail, and are reported separately so they
// can't hide behind, or drag down, the headline.

import { describe, expect, it } from "bun:test";
import { optimize } from "../cli/chat-session.ts";
import { buildCorpus } from "./corpus.ts";
import { formatReport, runBenchmark } from "./harness.ts";

describe("corpus", () => {
	it("is deterministic across builds", () => {
		expect(JSON.stringify(buildCorpus())).toBe(JSON.stringify(buildCorpus()));
	});

	it("hides every needle in the raw conversation", () => {
		for (const s of buildCorpus()) {
			const raw = s.messages.map((m) => m.content).join("\n").toLowerCase();
			for (const n of s.needles) expect(raw).toContain(n.toLowerCase());
		}
	});
});

describe("pipeline safety on realistic conversations", () => {
	it("never loses or blanks the final user question", () => {
		for (const s of buildCorpus(2)) {
			const original = s.messages.at(-1)?.content ?? "";
			const sent = optimize(s.messages).messages.at(-1)?.content ?? "";
			// Normally the turn is untouched. When the question is INSIDE a big
			// paste the paste may be trimmed, but its final line (the question)
			// must survive verbatim.
			const question = original.trim().split("\n").filter(Boolean).at(-1) ?? "";
			expect(sent.length).toBeGreaterThan(0);
			expect(sent.endsWith(question)).toBe(true);
		}
	});

	it("never emits an empty turn", () => {
		for (const s of buildCorpus(2)) {
			for (const m of optimize(s.messages).messages) {
				expect(m.content.trim().length).toBeGreaterThan(0);
			}
		}
	});

	it("loses nothing on the below-gate control", () => {
		const control = runBenchmark({ iterations: 1, variants: 1 }).scenarios.find((s) => s.control);
		expect(control?.arms.guardian.retention).toBe(1);
		expect(control?.stages).toEqual({ extracted: false, folded: false, sharded: false });
	});
});

describe("benchmark report", () => {
	const report = runBenchmark({ iterations: 2, variants: 2 });

	it("cuts tokens substantially on realistic inputs", () => {
		expect(report.summary.meanReduction).toBeGreaterThan(0.5);
	});

	it("keeps at least as many facts as an equal-budget sliding window", () => {
		// The reason to use Guardian over simply truncating: at the same token
		// budget it must not be the worse choice.
		expect(report.summary.guardianRetention).toBeGreaterThanOrEqual(
			report.summary.windowRetention,
		);
	});

	it("renders one row per scenario plus the summary", () => {
		const text = formatReport(report).join("\n");
		for (const s of report.scenarios) expect(text).toContain(s.name);
		expect(text).toContain("fact retention");
	});

	it("keeps every needle on the non-adversarial scenarios", () => {
		// Query-aware extraction is what makes this hold on large pasted logs,
		// JSON and documents (it was 0-33% before the stage existed).
		expect(report.summary.guardianRetention).toBeGreaterThanOrEqual(0.99);
	});

	it("stays cheap: the typical scenario costs well under 100 ms", () => {
		// Median of per-scenario p50, not the worst p95: a wall-clock test inside
		// parallel workers must survive one noisy sample. A real regression (the
		// pre-extraction pipeline took ~270 ms on a 6k-token log) still trips it.
		const p50s = report.scenarios.map((s) => s.latencyMs.p50).sort((x, y) => x - y);
		const median = p50s[Math.floor(p50s.length / 2)] as number;
		expect(median).toBeLessThan(100);
	});

});
