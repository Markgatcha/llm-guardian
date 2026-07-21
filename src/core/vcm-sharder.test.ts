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
