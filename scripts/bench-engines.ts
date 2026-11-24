/**
 * Engine benchmark — semantic folding and VCM sharding in isolation: accuracy
 * (needle retention vs an equal-budget sliding window) and speed (cold p50 and
 * a scaling table). Model-free, offline.
 *
 * Run: `bun run bench:engines`  (--json for machine output)
 */
import { formatEngineReport, runEngineBench } from "../src/bench/engines.ts";

const report = runEngineBench();
console.log(process.argv.includes("--json") ? JSON.stringify(report, null, 2) : formatEngineReport(report).join("\n"));
