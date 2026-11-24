// Benchmark corpus — deterministic, realistic-sized conversations.
//
// The original benchmarks used 76–249 token conversations, below the 1000/2000
// token gates where folding and sharding switch on, so they mostly measured
// the retain filter. These scenarios are sized to the way harnesses are really
// used (long debugging sessions, pasted logs, tool output, documents) and each
// hides NEEDLES — exact strings a model would need to answer the final user
// question. Retention of the needles is the fidelity metric.
//
// Everything is generated from a seeded PRNG, so the corpus is identical on
// every machine and every run.

import type { ChatMessage } from "../core/types.ts";

export type Scenario = {
	name: string;
	/** What real-world workload this stands for. */
	description: string;
	messages: ChatMessage[];
	/** Exact substrings (case-insensitive) the answer depends on. */
	needles: string[];
	/** True for the control: below the gates, the pipeline should be a no-op. */
	control?: boolean;
};

/** mulberry32 — tiny seeded PRNG. */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const msg = (role: ChatMessage["role"], content: string): ChatMessage => ({
	role,
	content,
});

const SYSTEM =
	"You are a senior engineer helping the user. Be precise and answer from the conversation.";

const FILLER_ASSISTANT = [
	"Sure, happy to help with that. Let me think through the options carefully before suggesting anything.",
	"Good question. There are a few things worth checking here, and I'd start with the most likely causes first.",
	"That makes sense. Let's keep going and see whether the behaviour is consistent across the other environments as well.",
	"Thanks for the extra detail, that's really useful context. It narrows things down quite a bit actually.",
	"I understand. In general it's a good idea to verify the assumptions before changing anything in production.",
];
const FILLER_USER = [
	"ok thanks, that's helpful. let me try that and get back to you in a bit",
	"got it, I'll check the dashboard now and see what it shows for the last hour",
	"makes sense, one more thing I noticed is that it seems to happen mostly overnight",
	"cool, can you explain a little more about why that would matter here",
];

function pick<T>(r: () => number, xs: readonly T[]): T {
	return xs[Math.floor(r() * xs.length)] as T;
}

function hex(r: () => number, n: number): string {
	let s = "";
	for (let i = 0; i < n; i++) s += Math.floor(r() * 16).toString(16);
	return s;
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

function debugSession(): Scenario {
	const r = rng(11);
	const trace = Array.from(
		{ length: 28 },
		(_, i) =>
			`    at Worker.run (/srv/app/node_modules/etl-core/dist/worker.js:${120 + (i % 4)}:${9 + (i % 3)})`,
	).join("\n");
	const messages: ChatMessage[] = [msg("system", SYSTEM)];
	messages.push(
		msg(
			"user",
			"Our nightly job `nightly-etl-7` keeps dying in region eu-west-3 with exit code 137. It started after last week's release. Any idea?",
		),
		msg(
			"assistant",
			"Exit code 137 means the process was killed with SIGKILL, almost always the kernel OOM killer. Let's confirm memory usage first and then decide on a limit.",
		),
	);
	for (let i = 0; i < 6; i++) {
		messages.push(
			msg("user", pick(r, FILLER_USER)),
			msg("assistant", `${pick(r, FILLER_ASSISTANT)} ${pick(r, FILLER_ASSISTANT)}`),
		);
	}
	messages.push(
		msg(
			"user",
			`Here is the crash output:\n${trace}\nError: Worker terminated unexpectedly\n${trace}`,
		),
		msg(
			"assistant",
			"That trace only shows the worker pool being torn down, the real cause is the kill signal. Raise the container memory: set `MEMORY_LIMIT_MB=3072` for the job and re-run. If it still dies, profile the batch size.",
		),
	);
	for (let i = 0; i < 5; i++) {
		messages.push(
			msg("user", pick(r, FILLER_USER)),
			msg("assistant", `${pick(r, FILLER_ASSISTANT)} ${pick(r, FILLER_ASSISTANT)}`),
		);
	}
	messages.push(
		msg(
			"user",
			"Remind me: which job was failing, in what region, with what exit code, and which memory limit did we settle on?",
		),
	);
	return {
		name: "debug-session",
		description: "Long debugging chat with a pasted stack trace",
		messages,
		needles: ["nightly-etl-7", "eu-west-3", "137", "MEMORY_LIMIT_MB=3072"],
	};
}

function logDump(): Scenario {
	const r = rng(23);
	const lines: string[] = [];
	for (let i = 0; i < 260; i++) {
		const t = `2026-03-02T03:${String(Math.floor(i / 6)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}Z`;
		lines.push(
			`${t} INFO  req=${hex(r, 4)}-${hex(r, 4)} GET /api/v2/orders 200 ${20 + Math.floor(r() * 40)}ms cache=hit`,
		);
		if (i === 173) {
			lines.push(
				`${t} ERROR req=9f3c-77ab payment gateway timeout after 30000ms (upstream=billing-v2)`,
			);
		}
	}
	return {
		name: "log-dump",
		description: "Pasted service log with one buried error line",
		messages: [
			msg("system", SYSTEM),
			msg("user", `Here are the logs from last night:\n${lines.join("\n")}`),
			msg(
				"user",
				"Which request failed, why did it fail, and which upstream was involved?",
			),
		],
		needles: ["9f3c-77ab", "30000ms", "billing-v2"],
	};
}

function toolJson(): Scenario {
	const r = rng(37);
	const rows = Array.from({ length: 110 }, (_, i) => {
		const special = i === 71;
		return {
			sku: special ? "ZX-4491-Q" : `SK-${1000 + i}-${String.fromCharCode(65 + (i % 26))}`,
			warehouse: pick(r, ["ams-1", "fra-2", "dub-1"]),
			stock: special ? 0 : Math.floor(r() * 400),
			restock_eta: special ? "2026-03-14" : "2026-02-20",
			status: special ? "backordered" : "active",
		};
	});
	return {
		name: "tool-json",
		description: "Large repetitive JSON tool result",
		messages: [
			msg("system", SYSTEM),
			msg("user", "Look up our inventory."),
			msg("assistant", "Calling inventory.list ..."),
			msg("user", `Tool result:\n${JSON.stringify(rows, null, 2)}`),
			msg("user", "When is SKU ZX-4491-Q getting restocked, and how many are in stock?"),
		],
		needles: ["ZX-4491-Q", "2026-03-14", "backordered"],
	};
}

function docQa(): Scenario {
	const r = rng(41);
	const boiler = [
		"The parties acknowledge that this Agreement constitutes the entire understanding between them and supersedes all prior discussions.",
		"Each party shall bear its own costs and expenses incurred in connection with the negotiation and execution of this Agreement.",
		"No failure or delay in exercising any right under this Agreement shall operate as a waiver of that right.",
		"Notices under this Agreement must be in writing and delivered to the address specified in the signature page.",
		"The headings used in this Agreement are for convenience only and do not affect its interpretation.",
	];
	const paras: string[] = [];
	for (let i = 0; i < 34; i++) {
		paras.push(`${i + 1}. ${pick(r, boiler)} ${pick(r, boiler)}`);
		if (i === 9) paras.push("10A. The termination notice period is 45 days, given in writing.");
		if (i === 17) paras.push("18A. The governing law of this Agreement is the law of Singapore.");
		if (i === 26) paras.push("27A. Total liability is subject to a cap of USD 2,500,000.");
	}
	return {
		name: "doc-qa",
		description: "Contract Q&A with boilerplate and three key clauses",
		messages: [
			msg("system", SYSTEM),
			msg("user", `Please read this agreement:\n\n${paras.join("\n\n")}`),
			msg("user", "What is the notice period, governing law and liability cap?"),
		],
		needles: ["45 days", "Singapore", "2,500,000"],
	};
}

function verboseChat(): Scenario {
	const r = rng(53);
	const messages: ChatMessage[] = [msg("system", SYSTEM)];
	const facts = [
		"We deploy with `kubectl rollout` into the `payments-prod` namespace.",
		"The on-call rotation hands over every Tuesday at 09:00 UTC.",
		"Our p99 latency budget is 280ms for the checkout endpoint.",
	];
	facts.forEach((f, i) => {
		messages.push(
			msg("user", `Hi there! I hope you're doing well. I just wanted to mention, in case it helps: ${f} Thanks so much in advance for your help, I really appreciate it.`),
			msg("assistant", `${pick(r, FILLER_ASSISTANT)} ${pick(r, FILLER_ASSISTANT)} ${pick(r, FILLER_ASSISTANT)} Noted about that. ${pick(r, FILLER_ASSISTANT)}`),
		);
		for (let j = 0; j < 4; j++) {
			messages.push(
				msg("user", `${pick(r, FILLER_USER)}. Thank you again!`),
				msg("assistant", `${pick(r, FILLER_ASSISTANT)} ${pick(r, FILLER_ASSISTANT)}`),
			);
		}
		void i;
	});
	messages.push(
		msg("user", "Summarise what I told you: namespace, rotation handover, and latency budget."),
	);
	return {
		name: "verbose-chat",
		description: "Polite, padded chat with three facts spread through it",
		messages,
		needles: ["payments-prod", "Tuesday at 09:00", "280ms"],
	};
}

function shortChat(): Scenario {
	return {
		name: "short-chat",
		description: "Control: below the fold/shard gates, only the retain filter acts",
		control: true,
		messages: [
			msg("system", SYSTEM),
			msg("user", "My service `inventory-api` listens on port 8443."),
			msg("assistant", "Got it, port 8443 for inventory-api."),
			msg("user", "Which service and port did I mention?"),
		],
		needles: ["inventory-api", "8443"],
	};
}

export function buildCorpus(): Scenario[] {
	return [debugSession(), logDump(), toolJson(), docQa(), verboseChat(), shortChat()];
}
