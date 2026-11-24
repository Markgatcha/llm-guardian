import { describe, expect, it } from "bun:test";
import { extractThenFold } from "./context-stage.ts";
import { BLOB_TOKENS, extractLargeBlobs, extractRelevant } from "./query-extractor.ts";
import { estimateTokens } from "./token-counter.ts";
import type { ChatMessage } from "./types.ts";

const log = (n: number, special?: { at: number; line: string }) =>
	Array.from({ length: n }, (_, i) =>
		special && i === special.at
			? special.line
			: `2026-03-02T03:00:${String(i % 60).padStart(2, "0")}Z INFO req=${i.toString(16).padStart(4, "0")}-aaaa GET /api/orders 200 ${30 + (i % 9)}ms`,
	).join("\n");

describe("extractRelevant", () => {
	it("returns text that already fits the budget verbatim", () => {
		const r = extractRelevant("short text\nsecond line", "anything", { maxTokens: 500 });
		expect(r.changed).toBe(false);
		expect(r.text).toBe("short text\nsecond line");
	});

	it("keeps the line an identifier in the question points at", () => {
		const text = log(300, { at: 211, line: "2026-03-02T03:09:09Z INFO req=9f3c-77ab charged card ending 4242" });
		const r = extractRelevant(text, "What happened to req=9f3c-77ab?", { maxTokens: 300 });
		expect(r.text).toContain("req=9f3c-77ab");
		expect(r.tokens).toBeLessThanOrEqual(330);
	});

	it("surfaces a severe line even when the question shares no words with it", () => {
		const text = log(300, { at: 140, line: "2026-03-02T03:05:00Z ERROR payment gateway timeout after 30000ms" });
		const r = extractRelevant(text, "Why did it break?", { maxTokens: 300 });
		expect(r.text).toContain("30000ms");
	});

	it("keeps a pretty-printed JSON record whole, not cut mid-object", () => {
		const rows = Array.from({ length: 90 }, (_, i) => ({
			sku: i === 44 ? "ZX-4491-Q" : `SK-${i}`,
			stock: i === 44 ? 0 : i,
			eta: i === 44 ? "2026-03-14" : "2026-02-01",
		}));
		const r = extractRelevant(JSON.stringify(rows, null, 2), "restock eta for ZX-4491-Q", { maxTokens: 250 });
		expect(r.text).toContain('"sku": "ZX-4491-Q"');
		expect(r.text).toContain('"eta": "2026-03-14"');
	});

	it("preserves original order and marks every gap", () => {
		const text = log(200, { at: 150, line: "2026-03-02T03:05:00Z ERROR disk full on vol-9" });
		const r = extractRelevant(text, "disk vol-9", { maxTokens: 250 });
		expect(r.text).toMatch(/\[… \d+ lines? omitted …\]/);
		const stamps = [...r.text.matchAll(/req=([0-9a-f]{4})-aaaa/g)].map((m) => Number.parseInt(m[1] as string, 16));
		expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
	});

	it("keeps the tail when the question is inside the paste", () => {
		const text = `${log(250)}\n\nWhich request was the first one?`;
		const r = extractRelevant(text, "Which request was the first one?", { maxTokens: 250, keepTail: true });
		expect(r.text.endsWith("Which request was the first one?")).toBe(true);
	});

	it("is fast on a large paste", () => {
		const text = log(2500);
		const t0 = performance.now();
		extractRelevant(text, "any errors?", { maxTokens: 400 });
		expect(performance.now() - t0).toBeLessThan(250);
	});
});

describe("extractLargeBlobs", () => {
	const sys: ChatMessage = { role: "system", content: "be precise" };

	it("leaves small messages, system prompts and the question alone", () => {
		const msgs: ChatMessage[] = [
			sys,
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi" },
			{ role: "user", content: "what is 2+2?" },
		];
		const r = extractLargeBlobs(msgs);
		expect(r.extracted).toBe(0);
		expect(r.messages).toEqual(msgs);
	});

	it("shrinks a big paste and leaves the separate final question verbatim", () => {
		const paste = log(400, { at: 300, line: "2026-03-02T03:09:09Z ERROR vault sealed" });
		expect(estimateTokens(paste)).toBeGreaterThan(BLOB_TOKENS);
		const q = "Why is the vault failing?";
		const r = extractLargeBlobs([sys, { role: "user", content: paste }, { role: "user", content: q }]);
		expect(r.extracted).toBe(1);
		expect(r.messages.at(-1)?.content).toBe(q);
		expect(r.messages[1]?.content).toContain("vault sealed");
		expect(r.indices.has(1)).toBe(true);
	});

	it("uses the last paragraph as the question when the paste is the final turn", () => {
		const paste = log(400, { at: 300, line: "2026-03-02T03:09:09Z ERROR vault sealed" });
		const r = extractLargeBlobs([sys, { role: "user", content: `${paste}\n\nWhy is the vault failing?` }]);
		expect(r.messages[1]?.content).toContain("vault sealed");
		expect(r.messages[1]?.content.endsWith("Why is the vault failing?")).toBe(true);
	});
});

describe("extractThenFold", () => {
	it("does not fold messages that extraction already cut", () => {
		const paste = log(400, { at: 300, line: "2026-03-02T03:09:09Z ERROR vault sealed" });
		const r = extractThenFold(
			[
				{ role: "system", content: "s" },
				{ role: "user", content: paste },
				{ role: "user", content: "Why is the vault failing?" },
			],
			{ foldGate: 1000 },
		);
		expect(r.extracted).toBe(true);
		expect(r.folded).toBe(false);
		expect(r.messages[1]?.content).toContain("vault sealed");
	});
});
