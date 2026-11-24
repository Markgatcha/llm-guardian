// Engine benchmark tests: folding and sharding in isolation.
//
// Each scenario here was a measured failure of the previous engines:
//   near-duplicate-facts   fold 0%   (dedup merged sentences differing in a port)
//   one-giant-message      shard 0%  (a message bigger than the budget was dropped whole)
//   near-duplicate-turns   shard 20% (dedup + no identifier weighting)
//   scattered-facts-chat   shard 67% (no relevance beyond crude term overlap)

import { describe, expect, it } from "bun:test";
import { buildEngineScenarios, formatEngineReport, runEngineBench } from "./engines.ts";

describe("engine scenarios", () => {
	it("are deterministic", () => {
		expect(JSON.stringify(buildEngineScenarios(2))).toBe(JSON.stringify(buildEngineScenarios(2)));
	});

	it("hide every needle in the raw conversation", () => {
		for (const s of buildEngineScenarios(3)) {
			const raw = s.messages.map((m) => m.content).join("\n").toLowerCase();
			for (const n of s.needles) expect(raw).toContain(n.toLowerCase());
		}
	});
});

describe("engines in isolation", () => {
	const report = runEngineBench({ variants: 3, iterations: 1, scaling: false });
	const row = (name: string) => report.rows.find((r) => r.name === name)!;

	it("fold keeps the one value that near-duplicate sentences differ in", () => {
		expect(row("near-duplicate-facts").retention).toBe(1);
	});

	it("shard keeps every needed fact in every scenario", () => {
		for (const r of report.rows.filter((x) => x.kind === "shard")) {
			expect(r.retention).toBeGreaterThanOrEqual(0.99);
		}
	});

	it("shard keeps the needle from a message larger than its whole budget", () => {
		const r = row("one-giant-message");
		expect(r.retention).toBe(1);
		expect(r.outTokens).toBeLessThan(r.rawTokens * 0.25);
	});

	it("never loses or alters the final question", () => {
		for (const r of report.rows) expect(r.questionKept).toBe(1);
	});

	it("beats an equal-budget sliding window", () => {
		const mean = (f: (r: (typeof report.rows)[number]) => number) =>
			report.rows.reduce((s, r) => s + f(r), 0) / report.rows.length;
		expect(mean((r) => r.retention)).toBeGreaterThan(mean((r) => r.windowRetention));
	});

	it("renders every scenario", () => {
		const text = formatEngineReport(report).join("\n");
		for (const r of report.rows) expect(text).toContain(r.name);
	});
});
