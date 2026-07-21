import { describe, it, expect } from "bun:test";
import { fuseToolOutputs, fuseToolMessages } from "./tool-fuser.ts";
import type { ChatMessage, ToolOutput } from "./types.ts";

describe("tool-fuser", () => {
  it("returns an empty fused block for no outputs", () => {
    const result = fuseToolOutputs([]);
    expect(result.fusedContent).toBe("");
    expect(result.originalOutputs).toHaveLength(0);
    expect(result.tokensSaved).toBe(0);
  });

  it("compresses a single string tool output", () => {
    const out: ToolOutput[] = [
      { toolName: "get_weather", result: "sunny, 22C, wind 5km/h", latencyMs: 10, tokens: 8 },
    ];
    const result = fuseToolOutputs(out);
    expect(result.fusedContent).toContain("[get_weather]");
    expect(result.fusedContent).toContain("sunny");
  });

  it("parses and compresses JSON string results", () => {
    const json = JSON.stringify({ result: "ok", data: { id: 1, status: "done" } });
    const result = fuseToolOutputs([
      { toolName: "query_db", result: json, latencyMs: 5, tokens: 50 },
    ]);
    expect(result.fusedContent).toContain("[query_db]");
    expect(result.fusedContent).toContain("status");
  });

  it("summarizes large array results with an item count", () => {
    const arr = Array.from({ length: 10 }, (_, i) => ({ id: i, name: `item-${i}` }));
    const result = fuseToolOutputs([
      { toolName: "list_users", result: arr, latencyMs: 5, tokens: 200 },
    ]);
    expect(result.fusedContent).toContain("10 items");
  });

  it("deduplicates identical outputs", () => {
    const dup: ToolOutput[] = [
      { toolName: "ping", result: "pong", latencyMs: 1, tokens: 2 },
      { toolName: "ping", result: "pong", latencyMs: 1, tokens: 2 },
      { toolName: "ping", result: "pong", latencyMs: 1, tokens: 2 },
    ];
    const result = fuseToolOutputs(dup);
    // Only one ping block should remain after dedup.
    expect((result.fusedContent.match(/\[ping\]/g) || []).length).toBe(1);
  });

  it("merges multiple calls to the same tool into one grouped block", () => {
    const outs: ToolOutput[] = [
      { toolName: "search", result: "result A", latencyMs: 1, tokens: 5 },
      { toolName: "search", result: "result B", latencyMs: 1, tokens: 5 },
    ];
    const result = fuseToolOutputs(outs);
    expect(result.fusedContent).toContain("search x2");
  });

  it("reports tokensSaved when fusion shrinks the payload", () => {
    const big = "x".repeat(500);
    const result = fuseToolOutputs([
      { toolName: "fetch", result: big, latencyMs: 1, tokens: 120 },
    ]);
    // Compression trims the 500-char blob; savings should be non-negative.
    expect(result.tokensSaved).toBeGreaterThanOrEqual(0);
  });

  it("fuseToolMessages collapses consecutive tool messages", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "What is the weather and time?" },
      { role: "tool", name: "get_weather", content: "sunny 22C" },
      { role: "tool", name: "get_time", content: "14:03" },
      { role: "assistant", content: "Here you go." },
    ];
    const { messages: fused, tokensSaved } = fuseToolMessages(messages);
    // The two tool messages merge into a single 'fused_tools' message.
    const toolMsgs = fused.filter((m) => m.role === "tool");
    expect(toolMsgs).toHaveLength(1);
    expect(toolMsgs[0].name).toBe("fused_tools");
    expect(tokensSaved).toBeGreaterThanOrEqual(0);
  });

  it("leaves a single tool message untouched", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "time?" },
      { role: "tool", name: "get_time", content: "14:03" },
    ];
    const { messages: fused } = fuseToolMessages(messages);
    expect(fused).toHaveLength(2);
    expect(fused[1].name).toBe("get_time");
  });
});
