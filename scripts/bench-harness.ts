/**
 * Harness benchmark — token reduction, fact retention and overhead of the real
 * Guardian pipeline, against equal-budget baselines. Model-free, offline.
 *
 * Run: `bun run bench:harness`   (add `--json` for machine output,
 *      `--write` to save scripts/bench-harness-results.json)
 */
import { writeFileSync } from "node:fs";
import { formatReport, runBenchmark } from "../src/bench/harness.ts";

const report = runBenchmark();

if (process.argv.includes("--json")) {
	console.log(JSON.stringify(report, null, 2));
} else {
	console.log(formatReport(report).join("\n"));
}
if (process.argv.includes("--write")) {
	writeFileSync("scripts/bench-harness-results.json", JSON.stringify(report, null, 2));
}
