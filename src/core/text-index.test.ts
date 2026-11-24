import { describe, expect, it } from "bun:test";
import { Bm25, DupIndex, identifiers, makeDoc, salientOf, termsOf } from "./text-index.ts";

describe("termsOf", () => {
	it("drops stopwords and stems", () => {
		expect(termsOf("Which requests were failing?")).toEqual(["request", "fail"]);
	});
});

describe("salientOf / identifiers", () => {
	it("treats numbers, compound ids and code spans as the fact", () => {
		const s = salientOf("Port 8080 on `web-1` for req=9f3c-77ab at 02:15 UTC.");
		for (const t of ["8080", "`web-1`", "req=9f3c-77ab", "02:15", "utc"]) expect(s.has(t)).toBe(true);
		expect(s.has("port")).toBe(false);
	});

	it("ignores trailing punctuation so '8080.' and '8080,' agree", () => {
		expect(salientOf("listens on 8080.")).toEqual(salientOf("listens on 8080,"));
	});

	it("finds compound identifiers inside a question", () => {
		expect(identifiers("what happened to req=9f3c-77ab and ZX-4491-Q?")).toEqual(["req=9f3c-77ab", "zx-4491-q"]);
	});

	it("stays linear on a pathological 200k-character token", () => {
		const t0 = performance.now();
		salientOf("x".repeat(200_000));
		identifiers("x".repeat(200_000));
		expect(performance.now() - t0).toBeLessThan(1000);
	});
});

describe("DupIndex", () => {
	const idx = (...texts: string[]) => {
		const d = new DupIndex(0.85);
		for (const t of texts) d.add(makeDoc(t));
		return d;
	};

	it("catches an exact repeat", () => {
		expect(idx("The service listens on port 8080.").isDup(makeDoc("The service listens on port 8080."))).toBe(true);
	});

	it("catches a near-duplicate that shares every fact", () => {
		const d = idx("Please deploy the billing service to production today with port 8080 open.");
		expect(d.isDup(makeDoc("Please deploy the billing service to production today with port 8080 open now."))).toBe(true);
	});

	it("never merges statements that differ in a number", () => {
		const d = idx("The staging environment of the payments service listens on port 8081.");
		expect(d.isDup(makeDoc("The staging environment of the payments service listens on port 9091."))).toBe(false);
	});

	it("does not mark anything a duplicate before it is added", () => {
		expect(new DupIndex().isDup(makeDoc("anything at all"))).toBe(false);
	});
});

describe("Bm25", () => {
	it("scores a rare matching term above a common one", () => {
		const docs = ["error in service", "service started", "service stopped", "service healthy"].map(makeDoc);
		const bm = new Bm25(docs);
		expect(bm.score(termsOf("error"), 0)).toBeGreaterThan(bm.score(termsOf("service"), 0));
	});
});
