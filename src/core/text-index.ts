// Shared text analysis for the folding engine, the VCM sharder and the
// query extractor.
//
// All three used to carry private copies of "tokenize, compare, score", and the
// copies had drifted: the fold and shard similarity re-tokenized both strings on
// EVERY comparison (O(n²) tokenizations), and their "cosine" was not normalized
// (a sentence repeating a shared word scored above 1). This module tokenizes
// each text once, scores with a real cosine, and finds near-duplicates through
// an inverted index so the cost follows the number of shared terms, not the
// square of the sentence count.

// ─── Tokens ──────────────────────────────────────────────────────────────────

export const STOP = new Set(
	"a an and are as at be but by can could did do does for from had has have how i if in into is it its me my of on or our so than that the their then there these they this to was we were what when where which who why will with would you your please tell show give remind about again also been just not now out over some such too very".split(
		" ",
	),
);

/** Pleasantries and acknowledgements: carry no facts, first to go. */
export const FILLER = new Set(
	"thanks thank sure happy glad great good okay ok sorry certainly absolutely appreciate welcome cool nice fine alright awesome perfect help helpful anyway".split(
		" ",
	),
);

const STEM_CACHE = new Map<string, string>();

/**
 * Light suffix stripping (ing/edly/ed/es/ly/s). Memoized: a corpus repeats the
 * same few thousand words, so most calls are a Map hit instead of a regex.
 */
export function stem(w: string): string {
	if (w.length <= 4) return w;
	let r = STEM_CACHE.get(w);
	if (r !== undefined) return r;
	if (w.endsWith("ing")) r = w.slice(0, -3);
	else if (w.endsWith("edly")) r = w.slice(0, -4);
	else if (w.endsWith("ed") || w.endsWith("es") || w.endsWith("ly")) r = w.slice(0, -2);
	else if (w.endsWith("s")) r = w.slice(0, -1);
	else r = w;
	if (!r) r = w;
	if (STEM_CACHE.size > 50_000) STEM_CACHE.clear();
	STEM_CACHE.set(w, r);
	return r;
}

/** Lowercased, stopword-free, stemmed terms. Compound ids split on punctuation. */
export function termsOf(s: string): string[] {
	const out: string[] = [];
	for (const w of s.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
		if (STOP.has(w)) continue;
		out.push(stem(w));
	}
	return out;
}

/**
 * Longest whitespace-delimited token the identifier/salience scanners will
 * look inside. Real identifiers are short; a 200,000-character "word" is a
 * pathological paste, and scanning inside it with unanchored patterns is
 * quadratic. Everything below is linear in the text for that reason.
 */
const MAX_TOKEN = 256;

const COMPOUND = /[A-Za-z0-9]+(?:[-_./:=][A-Za-z0-9]+)+/g;
const EDGE_PUNCT = /^[("'[{<]+|[)"'\]}>,;:!?.]+$/g;
const EDGE_TEST = /^[("'[{<]|[)"'\]}>,;:!?.]$/;

/** `ZX-4491-Q`, `req=9f3c-77ab`, `eu-west-3`: compound identifiers, lowercased. */
export function identifiers(text: string): string[] {
	const out = new Set<string>();
	for (const m of text.matchAll(/\S+/g)) {
		const tok = m[0];
		if (tok.length > MAX_TOKEN) continue;
		for (const id of tok.match(COMPOUND) ?? []) {
			if (id.length >= 4) out.add(id.toLowerCase());
		}
	}
	return [...out];
}

/**
 * Tokens that are *the fact* rather than the prose around it: anything with a
 * digit (ports, versions, ids, times), compound identifiers, code spans and
 * ALLCAPS names. Two sentences that differ in a salient token are different
 * statements however similar their wording. Edge punctuation is trimmed so
 * "8080." and "8080," are the same token.
 */
export function salientOf(text: string): Set<string> {
	const out = new Set<string>();
	for (const span of text.match(/`[^`\n]{1,200}`/g) ?? []) out.add(span.toLowerCase());
	for (const m of text.matchAll(/\S+/g)) {
		if (m[0].length > MAX_TOKEN) continue;
		const raw = m[0];
		const tok = EDGE_TEST.test(raw) ? raw.replace(EDGE_PUNCT, "") : raw;
		if (!tok) continue;
		if (/\d/.test(tok) || /^[A-Z]{3,}$/.test(tok) || /^[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)+$/.test(tok)) {
			out.add(tok.toLowerCase());
		}
	}
	return out;
}

// ─── Documents & similarity ──────────────────────────────────────────────────

export type Doc = {
	tf: Map<string, number>;
	/** Euclidean norm of the term-frequency vector. */
	norm: number;
	/** Number of (non-stopword) terms. */
	length: number;
	salient: Set<string>;
	fillerRatio: number;
	/** Memoized dedup keys (computed on first use, then reused by add()). */
	_key?: string;
	_sig?: string;
};

export function makeDoc(text: string): Doc {
	const terms = termsOf(text);
	const tf = new Map<string, number>();
	let filler = 0;
	for (const t of terms) {
		tf.set(t, (tf.get(t) ?? 0) + 1);
		if (FILLER.has(t)) filler++;
	}
	let sq = 0;
	for (const c of tf.values()) sq += c * c;
	return {
		tf,
		norm: Math.sqrt(sq),
		length: terms.length,
		salient: salientOf(text),
		fillerRatio: terms.length ? filler / terms.length : 0,
	};
}

/**
 * Finds near-duplicates among documents added so far.
 *
 * A candidate is a duplicate only when its cosine similarity to a kept document
 * reaches `threshold` AND the two carry the same salient tokens, so "listens on
 * port 8081" and "listens on port 9091" are never merged.
 *
 * Cost stays linear in the text:
 *   - exact repeats are caught by one hash lookup;
 *   - near-duplicates must share a salient signature, so documents are bucketed
 *     by it and only compared within their bucket;
 *   - inside a bucket an inverted index is walked, skipping terms common to
 *     more than MAX_POSTING documents. Skipped terms can only LOWER the computed
 *     similarity, so the shortcut errs toward keeping text, never toward
 *     merging two different statements.
 */
const MAX_POSTING = 48;

type Bucket = { postings: Map<string, number[]>; docs: Doc[] };

export class DupIndex {
	private buckets = new Map<string, Bucket>();
	private exact = new Set<string>();

	constructor(private readonly threshold = 0.85) {}

	private static signature(doc: Doc): string {
		return (doc._sig ??= [...doc.salient].sort().join("\u0001"));
	}

	/** Signature + canonical term bag: equal keys mean an exact repeat. */
	private static key(doc: Doc): string {
		return (doc._key ??= `${DupIndex.signature(doc)}\u0002${[...doc.tf.entries()]
			.sort(([a], [b]) => (a < b ? -1 : 1))
			.map(([t, c]) => `${t}:${c}`)
			.join(" ")}`);
	}

	/** True if `doc` duplicates something already added. Does not add it. */
	isDup(doc: Doc): boolean {
		if (!doc.norm) return false;
		const sig = DupIndex.signature(doc);
		if (this.exact.has(DupIndex.key(doc))) return true;

		const bucket = this.buckets.get(sig);
		if (!bucket) return false;
		const dots = new Map<number, number>();
		for (const [term, c] of doc.tf) {
			const ids = bucket.postings.get(term);
			if (!ids || ids.length > MAX_POSTING) continue;
			for (const id of ids) {
				const other = (bucket.docs[id] as Doc).tf.get(term) as number;
				dots.set(id, (dots.get(id) ?? 0) + c * other);
			}
		}
		for (const [id, dot] of dots) {
			const other = bucket.docs[id] as Doc;
			if (dot / (doc.norm * other.norm) >= this.threshold) return true;
		}
		return false;
	}

	add(doc: Doc): void {
		const sig = DupIndex.signature(doc);
		this.exact.add(DupIndex.key(doc));
		let bucket = this.buckets.get(sig);
		if (!bucket) {
			bucket = { postings: new Map(), docs: [] };
			this.buckets.set(sig, bucket);
		}
		const id = bucket.docs.length;
		bucket.docs.push(doc);
		for (const term of doc.tf.keys()) {
			const list = bucket.postings.get(term);
			if (list) list.push(id);
			else bucket.postings.set(term, [id]);
		}
	}
}

// ─── BM25 ────────────────────────────────────────────────────────────────────

export class Bm25 {
	private readonly df = new Map<string, number>();
	private readonly avgLen: number;

	constructor(
		private readonly docs: readonly Doc[],
		private readonly k1 = 1.2,
		private readonly b = 0.75,
	) {
		let total = 0;
		for (const d of docs) {
			total += d.length;
			for (const t of d.tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
		}
		this.avgLen = total / Math.max(1, docs.length);
	}

	private readonly idfCache = new Map<string, number>();

	idf(term: string): number {
		let v = this.idfCache.get(term);
		if (v === undefined) {
			const n = this.docs.length;
			const d = this.df.get(term) ?? 0;
			v = Math.log(1 + (n - d + 0.5) / (d + 0.5));
			this.idfCache.set(term, v);
		}
		return v;
	}

	/** Score of document `i` against already-stemmed query terms. */
	score(queryTerms: readonly string[], i: number): number {
		const doc = this.docs[i] as Doc;
		let s = 0;
		for (const t of queryTerms) {
			const f = doc.tf.get(t);
			if (!f) continue;
			s += (this.idf(t) * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * doc.length) / Math.max(1, this.avgLen)));
		}
		return s;
	}
}
