// Benchmark harness tests.
//
// These lock the properties the benchmark exists to protect. They deliberately
// do NOT assert today's fact-retention numbers for large pasted blobs: that is
// a known gap (see the todo below), and pinning a bad number would only make
// the eventual fix look like a regression.

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
	it("never alters or blanks the final user question", () => {
		for (const s of buildCorpus()) {
			const question = s.messages.at(-1)?.content;
			expect(optimize(s.messages).messages.at(-1)?.content).toBe(question);
		}
	});

	it("never emits an empty turn", () => {
		for (const s of buildCorpus()) {
			for (const m of optimize(s.messages).messages) {
				expect(m.content.trim().length).toBeGreaterThan(0);
			}
		}
	});

	it("loses nothing on the below-gate control", () => {
		const control = runBenchmark({ iterations: 1 }).scenarios.find((s) => s.control);
		expect(control?.arms.guardian.retention).toBe(1);
		expect(control?.stages).toEqual({ folded: false, sharded: false });
	});
});

describe("benchmark report", () => {
	const report = runBenchmark({ iterations: 2 });

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

	// Known gap, measured by `bun run bench:harness`: folding is query-blind and
	// sharding collapses to a skeleton, so a needle buried in a large pasted log
	// or JSON blob is dropped. Flip to a real test when query-aware extraction
	// lands.
	it.todo("keeps every needle in large pasted logs, JSON and documents");
});
