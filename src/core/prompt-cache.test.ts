import { describe, it, expect } from "bun:test";
import {
  structureForCaching,
  shouldUseTokenEfficientTools,
  MIN_CACHEABLE_PREFIX_TOKENS,
} from "./prompt-cache.ts";
import type { ChatMessage } from "./types.ts";

function big(text: string, n: number): string {
  // Repeat to push token count well above the 1024 cacheable floor.
  return Array.from({ length: n }, () => text).join(" ");
}

describe("prompt-cache", () => {
  it("passes messages through unchanged when caching disabled", () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ];
    const result = structureForCaching(msgs, { enableCaching: false });
    expect(result.cachingStructured).toBe(false);
    expect(result.messages).toBe(msgs);
  });

  it("does not structure when there is no trailing user message", () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "assistant", content: "reply" },
    ];
    const result = structureForCaching(msgs);
    expect(result.cachingStructured).toBe(false);
  });

  it("places a cache_control breakpoint on the last prefix message when prefix is large", () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: big("system context line", 120) },
      { role: "user", content: big("early user context", 120) },
      { role: "user", content: "latest user question?" },
    ];
    const result = structureForCaching(msgs);
    expect(result.cachingStructured).toBe(true);
    expect(result.prefixTokens).toBeGreaterThanOrEqual(MIN_CACHEABLE_PREFIX_TOKENS);
    // The breakpoint lands on the second message (last of the prefix).
    expect(result.messages[1].cache_control).toEqual({ type: "ephemeral" });
    // The volatile final user turn has no breakpoint.
    expect(result.messages[2].cache_control).toBeUndefined();
  });

  it("keeps the final user turn as the volatile suffix", () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: big("static system policy", 120) },
      { role: "user", content: big("prior discussion", 120) },
      { role: "user", content: "what is the deploy command?" },
    ];
    const result = structureForCaching(msgs);
    expect(result.messages[result.messages.length - 1].content).toContain(
      "deploy command",
    );
    expect(result.suffixTokens).toBeGreaterThan(0);
  });

  it("does not structure a small prefix even if there is a trailing user turn", () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: "short sys" },
      { role: "user", content: "short question" },
    ];
    const result = structureForCaching(msgs);
    expect(result.cachingStructured).toBe(false);
    expect(result.prefixTokens).toBeLessThan(MIN_CACHEABLE_PREFIX_TOKENS);
  });

  it("shouldUseTokenEfficientTools is true only when tools exist", () => {
    expect(shouldUseTokenEfficientTools(undefined)).toBe(false);
    expect(shouldUseTokenEfficientTools([])).toBe(false);
    expect(shouldUseTokenEfficientTools([{ name: "x" }])).toBe(true);
  });
});
