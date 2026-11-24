/**
 * Live answer-quality benchmark — does a real model still answer correctly when
 * the prompt went through Guardian?
 *
 * For each scenario the SAME conversation is sent twice to an OpenRouter model:
 * raw, and through the real `optimize()` pipeline. We score each answer on
 * needle recall (did it state the facts the question depends on?) and record
 * the provider's own prompt-token counts, which also checks the built-in
 * token estimator.
 *
 * Free models are rate limited and mostly reasoning models, so the script
 * retries 429/5xx with backoff, gives reasoning a large token budget, and
 * EXCLUDES calls that never succeeded from the scores — an upstream outage is
 * not a wrong answer.
 *
 * Run:  bun run bench:live
 * Env:  OPENROUTER_API_KEY   (optional inside a managed sandbox that injects it)
 *       MODEL      default baidu/ernie-5.5-flash-preview:free
 *       MAX_TOKENS default 2500   VARIANTS default 2   TRIALS default 1
 *       SCENARIOS  comma list; default = every non-control, non-adversarial one
 *       --hard     also run the adversarial scenarios
 *       --verbose  print each answer and which facts it missed
 *       --write    save scripts/bench-live-results.json
 */
import { writeFileSync } from "node:fs";
import { buildCorpus } from "../src/bench/corpus.ts";
import { optimize } from "../src/cli/chat-session.ts";
import type { ChatMessage } from "../src/core/types.ts";

const MODEL = process.env.MODEL || "baidu/ernie-5.5-flash-preview:free";
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 2500);
const VARIANTS = Number(process.env.VARIANTS || 2);
const TRIALS = Number(process.env.TRIALS || 1);
const WANT = (process.env.SCENARIOS || "").split(",").filter(Boolean);
const HARD = process.argv.includes("--hard");
const URL = "https://openrouter.ai/api/v1/chat/completions";

type Call = { answer: string; promptTokens: number } | null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ask(messages: ChatMessage[]): Promise<Call> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	// Only send our own Authorization when a key is configured; a managed
	// sandbox injects it at the proxy instead.
	if (process.env.OPENROUTER_API_KEY) {
		headers.Authorization = `Bearer ${process.env.OPENROUTER_API_KEY}`;
	}
	for (let attempt = 0; attempt < 6; attempt++) {
		try {
			const res = await fetch(URL, {
				method: "POST",
				headers,
				signal: AbortSignal.timeout(150_000),
				body: JSON.stringify({
					model: MODEL,
					messages,
					max_tokens: MAX_TOKENS,
					temperature: 0,
				}),
			});
			const body = (await res.json()) as {
				error?: { code?: number; message?: string };
				choices?: { message?: { content?: string | null } }[];
				usage?: { prompt_tokens?: number };
			};
			const transient = res.status === 429 || res.status >= 500 || body.error?.code === 429;
			if (transient) {
				await sleep(Math.min(40_000, 3000 * 2 ** attempt));
				continue;
			}
			if (body.error) return null;
			const answer = body.choices?.[0]?.message?.content ?? "";
			// An empty answer means the budget went to reasoning: retry once more
			// rather than score a non-answer.
			if (!answer.trim()) {
				await sleep(2000);
				continue;
			}
			return { answer, promptTokens: body.usage?.prompt_tokens ?? 0 };
		} catch {
			await sleep(Math.min(40_000, 3000 * 2 ** attempt));
		}
	}
	return null;
}

// Tolerant matching: a model that writes "30,000 ms" has answered correctly
// for the needle "30000ms". Markdown marks, digit-group commas and all
// whitespace are ignored on both sides.
const norm = (s: string) =>
	s
		.toLowerCase()
		.replace(/[`*_]/g, "")
		.replace(/(?<=\d),(?=\d{3})/g, "")
		.replace(/\s+/g, "");
const recall = (answer: string, needles: string[]) =>
	needles.filter((n) => norm(answer).includes(norm(n))).length / needles.length;

type Row = {
	scenario: string;
	variant: number;
	rawTokens: number;
	optTokens: number;
	rawRecall: number;
	optRecall: number;
	/**
	 * Of the facts the model stated from the RAW prompt, the share it still
	 * states from the optimized one. 1 = optimizing broke nothing the model
	 * could do. Unlike plain recall it ignores facts no answer ever contains
	 * (a model that refuses or rewrites them), which say nothing about Guardian.
	 */
	preserved: number | null;
}

const scenarios = buildCorpus(VARIANTS).filter((s) => {
	if (s.control) return false;
	if (s.hard && !HARD) return false;
	return WANT.length ? WANT.includes(s.name) : true;
});

console.log(`model=${MODEL} max_tokens=${MAX_TOKENS} variants=${VARIANTS} trials=${TRIALS}`);
console.log(`${scenarios.length} scenario variants x 2 arms x ${TRIALS} trial(s)\n`);

const rows: Row[] = [];
const seen = new Map<string, number>();
let skipped = 0;

for (const s of scenarios) {
	const variant = seen.get(s.name) ?? 0;
	seen.set(s.name, variant + 1);
	const optimized = optimize(s.messages).messages;

	const raw: number[] = [];
	const opt: number[] = [];
	const kept: number[] = [];
	let rawTok = 0;
	let optTok = 0;
	for (let t = 0; t < TRIALS; t++) {
		const a = await ask(s.messages);
		const b = await ask(optimized);
		// Score only matched pairs: if either arm never answered, drop both.
		if (!a || !b) {
			skipped++;
			continue;
		}
		raw.push(recall(a.answer, s.needles));
		opt.push(recall(b.answer, s.needles));
		const rawHits = s.needles.filter((n) => norm(a.answer).includes(norm(n)));
		if (rawHits.length) {
			kept.push(rawHits.filter((n) => norm(b.answer).includes(norm(n))).length / rawHits.length);
		}
		if (process.argv.includes("--verbose")) {
			for (const [label, call] of [["raw", a], ["optimized", b]] as const) {
				const missed = s.needles.filter((n) => !norm(call.answer).includes(norm(n)));
				console.log(`  [${label}] missed: ${missed.length ? missed.join(", ") : "none"}\n    ${call.answer.trim().replace(/\n+/g, " ").slice(0, 400)}`);
			}
		}
		rawTok = a.promptTokens;
		optTok = b.promptTokens;
	}
	if (!raw.length) {
		console.log(`${s.name.padEnd(16)} #${variant}  (no successful pair — excluded)`);
		continue;
	}
	const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
	const row: Row = {
		scenario: s.name,
		variant,
		rawTokens: rawTok,
		optTokens: optTok,
		rawRecall: mean(raw),
		optRecall: mean(opt),
		preserved: kept.length ? mean(kept) : null,
	};
	rows.push(row);
	console.log(
		`${s.name.padEnd(16)} #${variant}  prompt tok ${String(rawTok).padStart(5)} -> ${String(optTok).padStart(5)} (${(
			(1 - optTok / Math.max(1, rawTok)) * 100
		).toFixed(0)}% real saving)   recall raw ${(row.rawRecall * 100).toFixed(0)}% opt ${(row.optRecall * 100).toFixed(0)}%  preserved ${row.preserved === null ? "n/a" : `${(row.preserved * 100).toFixed(0)}%`}`,
	);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const summary = {
	model: MODEL,
	pairsScored: rows.length,
	pairsSkipped: skipped,
	meanRealTokenSaving: mean(rows.map((r) => 1 - r.optTokens / Math.max(1, r.rawTokens))),
	meanRawRecall: mean(rows.map((r) => r.rawRecall)),
	meanOptimizedRecall: mean(rows.map((r) => r.optRecall)),
	meanPreserved: mean(rows.flatMap((r) => (r.preserved === null ? [] : [r.preserved]))),
};
console.log(
	`\npairs scored: ${summary.pairsScored} (skipped ${summary.pairsSkipped} after retries)` +
		`\nreal prompt-token saving : ${(summary.meanRealTokenSaving * 100).toFixed(1)}%` +
		`\nanswer recall, raw       : ${(summary.meanRawRecall * 100).toFixed(1)}%` +
		`\nanswer recall, optimized : ${(summary.meanOptimizedRecall * 100).toFixed(1)}%` +
		`\ndelta (optimized - raw)  : ${((summary.meanOptimizedRecall - summary.meanRawRecall) * 100).toFixed(1)} pp` +
		`\npreserved (facts the model got from raw that it still gets): ${(summary.meanPreserved * 100).toFixed(1)}%`,
);

if (process.argv.includes("--write")) {
	writeFileSync(
		"scripts/bench-live-results.json",
		JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2),
	);
}
