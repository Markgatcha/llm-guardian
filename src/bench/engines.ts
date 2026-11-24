// Engine benchmark — folding and sharding measured in isolation.
//
// `harness.ts` scores the whole pipeline. That hides which stage is responsible
// for a loss or for time spent, and once extraction exists it can mask a weak
// engine behind it. Here each engine runs alone:
//
//   fold   foldMessages(preserveLastUser)  — per-message sentence selection
//   shard  shardMessages(query, budget)    — whole-conversation selection
//
// Accuracy: needle retention, scored the same way as the pipeline benchmark,
// against a sliding window cut to the SAME token count. Speed: cold p50 (fold
// cache cleared every iteration) plus a scaling table, since the interesting
// failure is super-linear growth, not a slow constant.

import { clearFoldCache, foldMessages } from "../core/folding-engine.ts";
import { estimateTokens } from "../core/token-counter.ts";
import type { ChatMessage } from "../core/types.ts";
import { shardMessages } from "../core/vcm-sharder.ts";
import { hex, msg, pick, rng } from "./corpus.ts";
import { score, tokens, windowTo } from "./harness.ts";

export type EngineKind = "fold" | "shard";

export type EngineScenario = {
	name: string;
	kind: EngineKind;
	description: string;
	messages: ChatMessage[];
	needles: string[];
	/** Shard budget as a fraction of the raw tokens (ignored for fold). */
	budgetRatio?: number;
};

const SYSTEM = "You are a helpful engineer. Answer from the conversation.";
const THINGS = [
	"deploy script",
	"error budget",
	"staging dashboard",
	"retry policy",
	"cache warmup",
	"load balancer",
	"feature rollout",
	"alert thresholds",
	"cron schedule",
	"connection pool",
	"log retention",
	"release checklist",
];
const USER_FILLER = (r: () => number) =>
	`Could you also take a look at the ${pick(r, THINGS)} before we move on to the next item? No rush at all.`;
const ASSISTANT_FILLER = (r: () => number) =>
	`Sure. I went through the ${pick(r, THINGS)} and nothing unusual stands out, so we can leave it as it is for now and revisit later if needed.`;

// ─── Fold scenarios ──────────────────────────────────────────────────────────

/** Many sentences identical except one value: a naive dedup keeps one. */
function foldNearDup(seed: number): EngineScenario {
	const r = rng(101 + seed * 7919);
	const envs = ["development", "staging", "canary", "production", "qa", "sandbox"];
	const svcs = ["payments", "orders", "search", "billing", "inventory", "auth"];
	const target = { env: "production", svc: pick(r, svcs) };
	let needle = "";
	const sentences: string[] = [];
	for (const svc of svcs) {
		for (const env of envs) {
			const port = 8000 + Math.floor(r() * 1900);
			if (env === target.env && svc === target.svc) needle = String(port);
			sentences.push(`The ${env} environment of the ${svc} service listens on port ${port}.`);
		}
	}
	// Shuffle so the target is not always at the same spot.
	for (let i = sentences.length - 1; i > 0; i--) {
		const j = Math.floor(r() * (i + 1));
		[sentences[i], sentences[j]] = [sentences[j] as string, sentences[i] as string];
	}
	return {
		name: "near-duplicate-facts",
		kind: "fold",
		description: "36 sentences identical but for one value; question needs one",
		messages: [
			msg("system", SYSTEM),
			msg("user", `Here is the port table:\n${sentences.join(" ")}`),
			msg("user", `Which port does the ${target.svc} service use in the production environment?`),
		],
		needles: [needle],
	};
}

// ─── Shard scenarios ─────────────────────────────────────────────────────────

const FACTS: readonly { say: string; needle: string; ask: string }[] = [
	{ say: "The billing cron runs at 02:15 UTC every night.", needle: "02:15 UTC", ask: "what time the billing cron runs" },
	{ say: "Our Redis cluster is named cache-eu-7 in the Frankfurt zone.", needle: "cache-eu-7", ask: "what the Redis cluster is called" },
	{ say: "The on-call pager alias is oncall-payments for this quarter.", needle: "oncall-payments", ask: "the on-call pager alias" },
	{ say: "Database backups are retained for 35 days before deletion.", needle: "35 days", ask: "how long backups are retained" },
	{ say: "The staging database listens on port 5543 behind the proxy.", needle: "5543", ask: "which port the staging database uses" },
	{ say: "The checkout feature flag is called new_checkout_v2 in the console.", needle: "new_checkout_v2", ask: "the checkout feature flag name" },
];

/** 60 turns, six facts scattered, the question asks for three. */
function shardLongChat(seed: number): EngineScenario {
	const r = rng(211 + seed * 7919);
	const slots = new Set<number>();
	while (slots.size < FACTS.length) slots.add(2 + 2 * Math.floor(r() * 26)); // user turns
	const order = [...slots].sort((a, b) => a - b);
	const messages: ChatMessage[] = [msg("system", SYSTEM)];
	let f = 0;
	for (let i = 0; i < 56; i++) {
		if (i % 2 === 0) {
			const isFact = order.includes(i) && f < FACTS.length;
			messages.push(msg("user", isFact ? (FACTS[f++] as (typeof FACTS)[number]).say : USER_FILLER(r)));
		} else {
			messages.push(msg("assistant", ASSISTANT_FILLER(r)));
		}
	}
	const asked = [0, 1, 3].map((i) => FACTS[i] as (typeof FACTS)[number]);
	messages.push(
		msg("user", `Remind me: ${asked.map((a) => a.ask).join(", ")}?`),
	);
	return {
		name: "scattered-facts-chat",
		kind: "shard",
		description: "57-turn chat, six facts scattered, question needs three",
		messages,
		needles: asked.map((a) => a.needle),
		budgetRatio: 0.3,
	};
}

/** One 6k-token message plus a question: only chunk-level selection can cope. */
function shardBigSingle(seed: number): EngineScenario {
	const r = rng(307 + seed * 7919);
	const at = 20 + Math.floor(r() * 220);
	const lines: string[] = [];
	for (let i = 0; i < 260; i++) {
		lines.push(
			`2026-03-02T03:${String(Math.floor(i / 6)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}Z INFO  req=${hex(r, 4)}-${hex(r, 4)} GET /api/v2/orders 200 ${20 + Math.floor(r() * 40)}ms cache=hit`,
		);
		if (i === at) {
			lines.push(
				`2026-03-02T03:09:09Z ERROR req=9f3c-77ab payment gateway timeout after 30000ms (upstream=billing-v2)`,
			);
		}
	}
	return {
		name: "one-giant-message",
		kind: "shard",
		description: "6k-token paste in a single message (budget forces a partial keep)",
		messages: [
			msg("system", SYSTEM),
			msg("user", `Logs:\n${lines.join("\n")}`),
			msg("user", "Which request failed, why, and which upstream?"),
		],
		needles: ["9f3c-77ab", "30000ms", "billing-v2"],
		budgetRatio: 0.2,
	};
}

/** Repeated status lines differing in name/code: dedup must not eat the one asked about. */
function shardNearDup(seed: number): EngineScenario {
	const r = rng(401 + seed * 7919);
	const jobs = Array.from({ length: 36 }, (_, i) => `job-${100 + i}`);
	const target = pick(r, jobs);
	let needle = "";
	const messages: ChatMessage[] = [msg("system", SYSTEM)];
	for (const job of jobs) {
		const code = job === target ? 91 : 0;
		if (job === target) needle = `exit code ${code}`;
		messages.push(
			msg("assistant", `Status update: ${job} finished with exit code ${code} after ${40 + Math.floor(r() * 50)} seconds on the batch cluster.`),
		);
		messages.push(msg("user", "ok, keep going and tell me about the next one"));
	}
	messages.push(msg("user", `What exit code did ${target} finish with?`));
	return {
		name: "near-duplicate-turns",
		kind: "shard",
		description: "36 near-identical status turns; the question needs one value",
		messages,
		needles: [needle],
		budgetRatio: 0.3,
	};
}

/** The answer is in the last few turns: recency must be respected. */
function shardRecent(seed: number): EngineScenario {
	const r = rng(503 + seed * 7919);
	const messages: ChatMessage[] = [msg("system", SYSTEM)];
	for (let i = 0; i < 44; i++) {
		messages.push(msg(i % 2 === 0 ? "user" : "assistant", i % 2 === 0 ? USER_FILLER(r) : ASSISTANT_FILLER(r)));
	}
	messages.push(msg("assistant", "The fix is to raise `POOL_MAX_CONNECTIONS` to 64 and restart the worker group named batch-blue."));
	messages.push(msg("user", "Great. Please repeat exactly what you just told me to change, the value, and which group to restart."));
	return {
		name: "answer-in-last-turn",
		kind: "shard",
		description: "The needed fact is in the previous assistant turn, not matched by any keyword",
		messages,
		needles: ["POOL_MAX_CONNECTIONS", "64", "batch-blue"],
		budgetRatio: 0.15,
	};
}

export const ENGINE_VARIANTS = 5;

export function buildEngineScenarios(variants = ENGINE_VARIANTS): EngineScenario[] {
	const builders = [foldNearDup, shardLongChat, shardBigSingle, shardNearDup, shardRecent];
	return builders.flatMap((b) => Array.from({ length: variants }, (_, s) => b(s)));
}

// ─── Running ─────────────────────────────────────────────────────────────────

export type EngineRow = {
	name: string;
	kind: EngineKind;
	rawTokens: number;
	outTokens: number;
	retention: number;
	windowRetention: number;
	/** Fraction of variants whose final user message came through verbatim. */
	questionKept: number;
	p50Ms: number;
};

function runOnce(s: EngineScenario): { messages: ChatMessage[] } {
	const query = s.messages.at(-1)?.content ?? "";
	if (s.kind === "fold") {
		return foldMessages(s.messages, { maxTokens: 2000, preserveLastUser: true });
	}
	const raw = tokens(s.messages);
	const budget = Math.max(150, Math.floor(raw * (s.budgetRatio ?? 0.3)));
	return shardMessages(s.messages, query, { maxTokens: budget });
}

function timeIt(s: EngineScenario, iterations: number): number {
	const samples: number[] = [];
	for (let i = 0; i < iterations + 2; i++) {
		clearFoldCache();
		const t0 = performance.now();
		runOnce(s);
		if (i >= 2) samples.push(performance.now() - t0);
	}
	samples.sort((a, b) => a - b);
	return samples[Math.floor(samples.length / 2)] as number;
}

export function runEngineBench(
	opts: { variants?: number; iterations?: number; scaling?: boolean } = {},
) {
	const iterations = opts.iterations ?? 7;
	const groups = new Map<string, EngineScenario[]>();
	for (const s of buildEngineScenarios(opts.variants)) {
		groups.set(s.name, [...(groups.get(s.name) ?? []), s]);
	}
	const rows: EngineRow[] = [];
	for (const [name, list] of groups) {
		let ret = 0;
		let win = 0;
		let out = 0;
		let raw = 0;
		let q = 0;
		let ms = 0;
		for (const s of list) {
			clearFoldCache();
			const res = runOnce(s).messages;
			const guard = score(res, s.needles);
			out += guard.tokens;
			ret += guard.retention;
			raw += tokens(s.messages);
			win += score(windowTo(s.messages, guard.tokens), s.needles).retention;
			q += res.at(-1)?.content === s.messages.at(-1)?.content ? 1 : 0;
			ms += timeIt(s, iterations);
		}
		const n = list.length;
		rows.push({
			name,
			kind: (list[0] as EngineScenario).kind,
			rawTokens: Math.round(raw / n),
			outTokens: Math.round(out / n),
			retention: ret / n,
			windowRetention: win / n,
			questionKept: q / n,
			p50Ms: ms / n,
		});
	}
	return { rows, scaling: opts.scaling === false ? [] : runScaling() };
}

// ─── Scaling ─────────────────────────────────────────────────────────────────

function proseOfTokens(target: number): string {
	const r = rng(7);
	const out: string[] = [];
	let t = 0;
	while (t < target) {
		const s = `The ${pick(r, THINGS)} for the ${pick(r, ["billing", "search", "orders", "auth"])} service was reviewed on day ${Math.floor(r() * 300)} and the owner confirmed that ${pick(r, THINGS)} needs another pass before release number ${Math.floor(r() * 900)}.`;
		out.push(s);
		t += estimateTokens(s);
	}
	return out.join(" ");
}

export type ScalingRow = { engine: string; size: string; ms: number };

function runScaling(): ScalingRow[] {
	const rows: ScalingRow[] = [];
	const med = (f: () => void) => {
		const xs: number[] = [];
		for (let i = 0; i < 5; i++) {
			clearFoldCache();
			const t0 = performance.now();
			f();
			xs.push(performance.now() - t0);
		}
		xs.sort((a, b) => a - b);
		return xs[2] as number;
	};
	for (const t of [1000, 4000, 16000, 32000]) {
		const text = proseOfTokens(t);
		const msgs: ChatMessage[] = [msg("user", text), msg("user", "What was reviewed?")];
		rows.push({
			engine: "fold",
			size: `${t / 1000}k tok`,
			ms: med(() => foldMessages(msgs, { maxTokens: 2000, preserveLastUser: true })),
		});
	}
	for (const n of [20, 100, 400, 1000]) {
		const r = rng(n);
		const msgs: ChatMessage[] = [msg("system", SYSTEM)];
		for (let i = 0; i < n; i++) msgs.push(msg(i % 2 ? "assistant" : "user", i % 2 ? ASSISTANT_FILLER(r) : USER_FILLER(r)));
		msgs.push(msg("user", "What did we decide about the retry policy?"));
		rows.push({
			engine: "shard",
			size: `${n} turns`,
			ms: med(() => shardMessages(msgs, "What did we decide about the retry policy?", { maxTokens: 1500 })),
		});
	}
	return rows;
}

// ─── Rendering ───────────────────────────────────────────────────────────────

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

export function formatEngineReport(r: ReturnType<typeof runEngineBench>): string[] {
	const out: string[] = [];
	const head = ["engine", "scenario".padEnd(22), "raw tok".padStart(8), "out tok".padStart(8), "kept".padStart(6), "window*".padStart(8), "question".padStart(9), "ms p50".padStart(8)].join("  ");
	out.push(head, "-".repeat(head.length));
	for (const x of r.rows) {
		out.push(
			[
				x.kind.padEnd(6),
				x.name.padEnd(22),
				String(x.rawTokens).padStart(8),
				String(x.outTokens).padStart(8),
				pct(x.retention).padStart(6),
				pct(x.windowRetention).padStart(8),
				pct(x.questionKept).padStart(9),
				x.p50Ms.toFixed(2).padStart(8),
			].join("  "),
		);
	}
	out.push("", "* equal-budget sliding window.   question = final user turn delivered verbatim", "", "scaling (cold, median ms)");
	for (const s of r.scaling) out.push(`  ${s.engine.padEnd(6)} ${s.size.padEnd(10)} ${s.ms.toFixed(2).padStart(9)}`);
	return out;
}
