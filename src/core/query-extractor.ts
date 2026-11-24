// Query-aware extraction — keep the parts of a big paste the question is about.
//
// Why this exists
// ---------------
// Semantic folding is query-BLIND: it compresses a 6k-token log the same way
// whatever you ask, and so it can drop the one ERROR line the question needs
// (see `guardian bench`: 0% fact retention on a pasted service log). The VCM
// sharder is query-aware but collapses to a skeleton instead of honoring its
// budget. This stage fills the gap for the common big-paste case.
//
// How it works (no model, no network, a few ms)
// ---------------------------------------------
//   1. Split the text into UNITS: a log line, a JSON record, a paragraph.
//      Structure is detected from indentation, so a pretty-printed JSON record
//      stays whole instead of being cut mid-object.
//   2. Score every unit:
//        BM25 against the question        — rare shared words count most
//        exact identifier hits            — `ZX-4491-Q`, `req=9f3c-77ab`
//        salience prior (query-independent) — severity words (ERROR, timeout)
//                                           and lines whose *shape* is rare
//                                           among many near-identical lines.
//      The prior is what rescues questions phrased differently from the text
//      ("why did it fail?" vs a line that says "timeout").
//   3. Keep the best units within the token budget, then spend a little of it
//      on their neighbours for context. Output stays in ORIGINAL order, and
//      every gap is replaced by an explicit `[… N lines omitted …]` marker so
//      the model knows text is missing rather than assuming it read it all.
//
// Limits (be honest about them): it is lexical. A question that shares no
// words, identifiers or salience with the answer can still miss; the marker
// at least makes the omission visible.

import { Bm25, identifiers, makeDoc, termsOf as terms } from "./text-index.ts";
import { estimateTokens } from "./token-counter.ts";
import type { ChatMessage } from "./types.ts";

export type ExtractOptions = {
	/** Token budget for the result. */
	maxTokens: number;
	/** Always keep the final unit — used when the question is inside the paste. */
	keepTail?: boolean;
	/** Always keep the first unit (a header such as "Here are the logs:"). */
	keepHead?: boolean;
};

export type ExtractResult = {
	text: string;
	originalTokens: number;
	tokens: number;
	unitsKept: number;
	unitsTotal: number;
	/** False when the text already fit the budget and was returned verbatim. */
	changed: boolean;
};

// ─── Units ───────────────────────────────────────────────────────────────────

export type Unit = {
	text: string;
	/** Separator that preceded this unit in the source ("\n" or "\n\n"). */
	sep: string;
	lines: number;
};

const indentOf = (line: string) => line.length - line.trimStart().length;
const CLOSING = /^\s*[}\])]/;

/** Hard cap on a single unit so one giant line can't swallow the budget. */
const MAX_UNIT_CHARS = 700;

export function splitUnits(text: string): Unit[] {
	const lines = text.split("\n");
	const indents = lines
		.filter((l) => l.trim() && indentOf(l) > 0)
		.map(indentOf);
	const base = indents.length ? Math.min(...indents) : 0;

	const raw: { text: string; sep: string; lines: number }[] = [];
	let cur: string[] = [];
	let sep = "";
	let pendingBlank = false;

	const flush = () => {
		if (!cur.length) return;
		raw.push({ text: cur.join("\n"), sep, lines: cur.length });
		cur = [];
	};

	for (const line of lines) {
		if (!line.trim()) {
			flush();
			pendingBlank = true;
			continue;
		}
		const startsUnit =
			cur.length === 0 || (indentOf(line) <= base && !CLOSING.test(line));
		if (startsUnit) {
			flush();
			sep = raw.length === 0 ? "" : pendingBlank ? "\n\n" : "\n";
			pendingBlank = false;
		}
		cur.push(line);
	}
	flush();

	// Split any monster unit (a single minified line, a wall of prose) on
	// sentence boundaries.
	const units: Unit[] = [];
	for (const u of raw) {
		if (u.text.length <= MAX_UNIT_CHARS) {
			units.push(u);
			continue;
		}
		const parts = u.text.split(/(?<=[.!?;])\s+|(?<=,)\s+(?=.{200,})/);
		let buf = "";
		let first = true;
		const emit = () => {
			if (!buf) return;
			units.push({ text: buf, sep: first ? u.sep : " ", lines: 1 });
			first = false;
			buf = "";
		};
		for (const p of parts) {
			if (buf && buf.length + p.length > MAX_UNIT_CHARS) emit();
			buf = buf ? `${buf} ${p}` : p;
		}
		emit();
	}
	return units;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

const SEVERE =
	/\b(error|fatal|exception|panic|critical|traceback|fail(?:ed|ure|s)?|timeout|timed out|denied|refused|unauthori[sz]ed|crash(?:ed)?|oom|killed|segfault)\b/i;
const WARNISH = /\b(warn(?:ing)?|deprecated|retry(?:ing)?|slow)\b/i;

/** Collapse ids, hashes and numbers so near-identical lines share a shape. */
function shape(s: string): string {
	return s
		.toLowerCase()
		.replace(/[0-9a-f]{4,}/g, "#")
		.replace(/\d+/g, "#")
		.replace(/\s+/g, " ")
		.slice(0, 160);
}

/**
 * Query-independent salience of each unit: severity words, plus lines whose
 * shape is rare among many near-identical ones. This is what rescues a
 * question phrased differently from the text ("why did it fail?" vs a line
 * that says "timeout"). Roughly 0–2.5.
 */
export function unitPriors(units: readonly Unit[]): number[] {
	const n = units.length;
	const shapes = units.map((u) => shape(u.text));
	const shapeCount = new Map<string, number>();
	for (const sh of shapes) shapeCount.set(sh, (shapeCount.get(sh) ?? 0) + 1);

	return units.map((u, i) => {
		let prior = 0;
		if (SEVERE.test(u.text)) prior += 1.6;
		else if (WARNISH.test(u.text)) prior += 0.5;
		if (n >= 20 && (shapeCount.get(shapes[i] as string) ?? 1) <= 2) prior += 0.9;
		return prior;
	});
}

function scoreUnits(units: Unit[], query: string): number[] {
	const bm = new Bm25(units.map((u) => makeDoc(u.text)));
	const q = query.slice(-2000);
	const qTerms = [...new Set(terms(q))];
	const ids = identifiers(q);
	const priors = unitPriors(units);

	return units.map((u, i) => {
		const lower = u.text.toLowerCase();
		let idHit = 0;
		for (const id of ids) if (lower.includes(id)) idHit += 6;
		return bm.score(qTerms, i) + idHit + (priors[i] as number);
	});
}

// ─── Selection ───────────────────────────────────────────────────────────────

const OMITTED = (lines: number) => `[… ${lines} line${lines === 1 ? "" : "s"} omitted …]`;

/**
 * Join the chosen units in their original order, replacing every gap with an
 * explicit marker so a reader knows text is missing rather than assuming it
 * read everything.
 */
export function assembleUnits(units: readonly Unit[], chosen: ReadonlySet<number>): string {
	let out = "";
	let skippedLines = 0;
	let lastKept = -1;
	for (let i = 0; i < units.length; i++) {
		const u = units[i] as Unit;
		if (!chosen.has(i)) {
			skippedLines += u.lines;
			continue;
		}
		if (skippedLines > 0) {
			out += `${out ? "\n" : ""}${OMITTED(skippedLines)}\n`;
			skippedLines = 0;
			out += u.text;
		} else {
			out += (lastKept === -1 ? "" : u.sep) + u.text;
		}
		lastKept = i;
	}
	if (skippedLines > 0) out += `\n${OMITTED(skippedLines)}`;
	return out;
}

export function extractRelevant(
	text: string,
	query: string,
	opts: ExtractOptions,
): ExtractResult {
	const originalTokens = estimateTokens(text);
	const unchanged: ExtractResult = {
		text,
		originalTokens,
		tokens: originalTokens,
		unitsKept: 0,
		unitsTotal: 0,
		changed: false,
	};
	if (originalTokens <= opts.maxTokens) return unchanged;

	const units = splitUnits(text);
	if (units.length < 4) return unchanged;
	const cost = units.map((u) => estimateTokens(u.text) + 1);
	const scores = scoreUnits(units, query);

	const chosen = new Set<number>();
	let used = 0;
	const take = (i: number): boolean => {
		if (chosen.has(i) || i < 0 || i >= units.length) return false;
		if (used + (cost[i] as number) > opts.maxTokens) return false;
		chosen.add(i);
		used += cost[i] as number;
		return true;
	};

	if (opts.keepHead ?? true) take(0);
	if (opts.keepTail) take(units.length - 1);

	// Best units first, using ~75% of the budget; zero-score units are never
	// worth including on their own.
	const order = units.map((_, i) => i).sort((a, b) => (scores[b] as number) - (scores[a] as number));
	const primaryCap = Math.floor(opts.maxTokens * 0.75);
	const primary: number[] = [];
	for (const i of order) {
		if ((scores[i] as number) <= 0) break;
		if (used + (cost[i] as number) > primaryCap) continue;
		if (take(i)) primary.push(i);
	}
	// Spend what is left on neighbours of the winners (context around a hit).
	for (const i of primary) {
		take(i - 1);
		take(i + 1);
	}

	const out = assembleUnits(units, chosen);

	return {
		text: out,
		originalTokens,
		tokens: estimateTokens(out),
		unitsKept: chosen.size,
		unitsTotal: units.length,
		changed: true,
	};
}

// ─── Pipeline stage ──────────────────────────────────────────────────────────

/** A message this large is a "paste" worth extracting from. */
export const BLOB_TOKENS = 800;

/** Budget for an extracted blob: a quarter of it, clamped to a useful range. */
function blobBudget(tokens: number): number {
	return Math.max(300, Math.min(1200, Math.floor(tokens * 0.25)));
}

/**
 * Extract the relevant parts of every large non-system message, using the
 * final user turn as the question. Run BEFORE folding, so the query-blind
 * stage never sees (and never drops) the lines that matter.
 *
 * When the paste lives inside the final user message itself, its tail is kept
 * verbatim: that is where the question is.
 */
export function extractLargeBlobs(messages: ChatMessage[]): {
	messages: ChatMessage[];
	extracted: number;
	/** Indices of messages that were extracted (already budgeted; don't fold). */
	indices: Set<number>;
} {
	const indices = new Set<number>();
	const lastUser = messages.map((m) => m.role).lastIndexOf("user");
	if (lastUser === -1) return { messages, extracted: 0, indices };

	const last = messages[lastUser] as ChatMessage;
	// The question: the final user turn, or — when that turn is itself a big
	// paste — its last non-empty paragraph.
	const lastTokens = estimateTokens(last.content);
	const query =
		lastTokens > BLOB_TOKENS
			? (last.content.trim().split(/\n\s*\n|\n/).filter(Boolean).at(-1) ?? "")
			: last.content;

	let extracted = 0;
	const out = messages.map((m, i) => {
		if (m.role === "system" || m.role === "tool") return m;
		const tokens = estimateTokens(m.content);
		if (tokens <= BLOB_TOKENS) return m;
		const r = extractRelevant(m.content, query, {
			maxTokens: blobBudget(tokens),
			keepTail: i === lastUser,
		});
		if (!r.changed || !r.text.trim()) return m;
		extracted++;
		indices.add(i);
		return { ...m, content: r.text };
	});
	return { messages: out, extracted, indices };
}
