import { describe, it, expect } from "bun:test";
import { shardContext, shardMessages } from "./vcm-sharder.ts";
import type { ChatMessage } from "./types.ts";

function makeMessages(n: number, seed = "topic"): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `${seed} message number ${i} about deploying src/server.ts and calling POST /api/v1/health with model claude-4-opus. metric 42ms.`,
    });
  }
  return out;
}

const QUERY = "deploy the server and check health endpoint";

describe("vcm-sharder", () => {
  it("returns a sharding result with compression stats", () => {
    const msgs = makeMessages(10);
    const result = shardContext(msgs, QUERY, { maxTokens: 4000 });
    expect(result.originalTokens).toBeGreaterThan(0);
    expect(result.shardedTokens).toBeLessThanOrEqual(result.originalTokens);
    expect(result.compressionRatio).toBeGreaterThan(0);
    expect(Array.isArray(result.shards)).toBe(true);
  });

  it("keeps the injected context within the token budget", () => {
    const msgs = makeMessages(40);
    const result = shardContext(msgs, QUERY, { maxTokens: 600 });
    expect(result.shardedTokens).toBeLessThanOrEqual(600 + 1);
    // Context is the joined shard contents.
    expect(result.injectedContext.length).toBeGreaterThan(0);
  });

  it("reports budgetUsed and budgetTotal", () => {
    const result = shardContext(makeMessages(20), QUERY, { maxTokens: 800 });
    expect(result.budgetTotal).toBe(800);
    expect(result.budgetUsed).toBeLessThanOrEqual(800);
  });

  it("deduplicates near-identical shards (shardsDeduped > 0 for repeats)", () => {
    const repeated: ChatMessage[] = [];
    for (let i = 0; i < 8; i++) {
      repeated.push({
        role: "user",
        content:
          "Deploy src/server.ts and call POST /api/health with claude-4-opus. metric 42ms.",
      });
    }
    const result = shardContext(repeated, "deploy server health", { maxTokens: 4000 });
    // 8 near-identical messages should collapse to far fewer shards.
    expect(result.shards.length).toBeLessThan(8);
    expect(result.shardsDeduped).toBeGreaterThan(0);
  });

  it("shardMessages reconstructs messages preserving order by source index", () => {
    const msgs = makeMessages(12);
    const { messages, shardingResult } = shardMessages(msgs, QUERY, {
      maxTokens: 4000,
    });
    expect(messages.length).toBeLessThanOrEqual(msgs.length);
    // Order of kept messages follows their original positions.
    const indices = shardingResult.shards.map((s) => s.sourceIndices[0]);
    const sorted = [...indices].sort((a, b) => a - b);
    expect(indices).toEqual(sorted);
  });

  it("always retains system messages", () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: "SYSTEM INSTRUCTION that must stay. src/config.ts model gpt-5-turbo 100ms." },
      ...makeMessages(15),
    ];
    const result = shardContext(msgs, QUERY, { maxTokens: 4000 });
    expect(result.injectedContext).toContain("SYSTEM INSTRUCTION");
  });
});

// ─── Accuracy & robustness (chunk-level sharding) ───────────────────────────

import { estimateTokens } from "./token-counter.ts";

const filler = (i: number): ChatMessage => ({
  role: i % 2 === 0 ? "user" : "assistant",
  content:
    i % 2 === 0
      ? `Could you also check the staging dashboard number ${i} before we move on to the next item? No rush at all.`
      : `Sure. I went through the staging dashboard number ${i} and nothing unusual stands out, so we can leave it for now.`,
});

describe("vcm-sharder — accuracy", () => {
  it("keeps the relevant part of a message bigger than the whole budget", () => {
    const lines = Array.from({ length: 300 }, (_, i) => `2026-03-02T03:00:${String(i % 60).padStart(2, "0")}Z INFO req=${i.toString(16).padStart(4, "0")}-aaaa GET /api/orders 200 ${30 + (i % 9)}ms`);
    lines.splice(190, 0, "2026-03-02T03:09:09Z ERROR req=9f3c-77ab payment gateway timeout after 30000ms (upstream=billing-v2)");
    const msgs: ChatMessage[] = [
      { role: "system", content: "You are an engineer." },
      { role: "user", content: `Logs:\n${lines.join("\n")}` },
      { role: "user", content: "Which request failed and which upstream was involved?" },
    ];
    const r = shardMessages(msgs, msgs[2]!.content, { maxTokens: 400 });
    const text = r.messages.map((m) => m.content).join("\n");
    expect(text).toContain("9f3c-77ab");
    expect(text).toContain("billing-v2");
    expect(text).toMatch(/\[… \d+ lines? omitted …\]/);
    expect(r.shardingResult.shardedTokens).toBeLessThanOrEqual(401);
  });

  it("does not let near-identical turns hide the one value asked about", () => {
    const msgs: ChatMessage[] = [{ role: "system", content: "sys" }];
    for (let i = 0; i < 30; i++) {
      msgs.push({ role: "assistant", content: `Status update: job-${100 + i} finished with exit code ${i === 12 ? 91 : 0} after ${40 + i} seconds on the batch cluster.` });
      msgs.push({ role: "user", content: "ok, keep going and tell me about the next one" });
    }
    msgs.push({ role: "user", content: "What exit code did job-112 finish with?" });
    const r = shardMessages(msgs, msgs.at(-1)!.content, { maxTokens: 300 });
    expect(r.messages.map((m) => m.content).join("\n")).toContain("job-112 finished with exit code 91");
  });

  it("always delivers the final question verbatim, plus the turn before it", () => {
    const msgs: ChatMessage[] = [{ role: "system", content: "sys" }, ...Array.from({ length: 40 }, (_, i) => filler(i))];
    msgs.push({ role: "assistant", content: "Raise `POOL_MAX_CONNECTIONS` to 64 and restart batch-blue." });
    msgs.push({ role: "user", content: "Repeat exactly what you just told me." });
    const r = shardMessages(msgs, msgs.at(-1)!.content, { maxTokens: 150 });
    const out = r.messages.map((m) => m.content);
    expect(out.at(-1)).toBe("Repeat exactly what you just told me.");
    expect(out.join("\n")).toContain("POOL_MAX_CONNECTIONS");
  });

  it("treats the budget as a ceiling, not a target", () => {
    // Nothing in this conversation relates to the question: spare budget must
    // not be filled with it.
    const msgs: ChatMessage[] = [{ role: "system", content: "sys" }, ...Array.from({ length: 50 }, (_, i) => filler(i))];
    msgs.push({ role: "user", content: "Summarise the kubernetes certificate renewal procedure." });
    const r = shardContext(msgs, msgs.at(-1)!.content, { maxTokens: 3000 });
    expect(r.shardedTokens).toBeLessThan(600);
  });

  it("preserves roles and conversation order", () => {
    const msgs: ChatMessage[] = [{ role: "system", content: "sys" }, ...Array.from({ length: 30 }, (_, i) => filler(i))];
    msgs.push({ role: "user", content: "What about the staging dashboard number 7?" });
    const r = shardMessages(msgs, msgs.at(-1)!.content, { maxTokens: 400 });
    const idx = r.shardingResult.shards.map((s) => s.sourceIndices[0]!);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    r.messages.forEach((m, i) => expect(m.role).toBe(msgs[idx[i]!]!.role));
  });

  it("reports honest token counts per shard", () => {
    const r = shardContext(makeMessages(30), QUERY, { maxTokens: 500 });
    for (const s of r.shards) expect(s.tokens).toBe(estimateTokens(s.content));
  });

  it("handles empty and degenerate input without throwing", () => {
    expect(() => shardContext([], "q", { maxTokens: 100 })).not.toThrow();
    expect(() => shardContext([{ role: "user", content: "" }], "", { maxTokens: 100 })).not.toThrow();
    expect(() => shardContext([{ role: "system", content: "only system" }], "q")).not.toThrow();
  });

  it("stays fast on pathological input (no catastrophic backtracking)", () => {
    for (const content of ["x".repeat(200_000), "a-".repeat(100_000), "word ".repeat(40_000)]) {
      const t0 = performance.now();
      shardContext([{ role: "user", content }, { role: "user", content: "q" }], content, { maxTokens: 300 });
      expect(performance.now() - t0).toBeLessThan(2000);
    }
  });

  it("scales roughly linearly with conversation length", () => {
    const time = (n: number) => {
      const msgs: ChatMessage[] = [{ role: "system", content: "sys" }, ...Array.from({ length: n }, (_, i) => filler(i))];
      msgs.push({ role: "user", content: "What did we decide about the staging dashboard?" });
      const xs: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        shardContext(msgs, msgs.at(-1)!.content, { maxTokens: 800 });
        xs.push(performance.now() - t0);
      }
      return xs.sort((a, b) => a - b)[1] as number;
    };
    expect(time(800) / Math.max(time(100), 0.3)).toBeLessThan(30); // 8x input; quadratic would be ~64x
  });
});
