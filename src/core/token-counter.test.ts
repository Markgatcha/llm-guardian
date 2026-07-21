import { describe, it, expect } from "bun:test";
import {
  estimateTokens,
  estimateTokensTotal,
  setTokenizer,
  getTokenizer,
} from "./token-counter.ts";

describe("token-counter", () => {
  it("returns 0 for empty input", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   ")).toBe(0);
  });

  it("estimates more tokens for longer text", () => {
    const short = estimateTokens("hello world");
    const long = estimateTokens(
      "the quick brown fox jumps over the lazy dog while the sun sets behind the hills",
    );
    expect(long).toBeGreaterThan(short);
  });

  it("counts punctuation as separate tokens", () => {
    // A comma forces a space split, producing an extra token.
    const withPunct = estimateTokens("a,b,c,d,e");
    const withoutPunct = estimateTokens("a b c d e");
    expect(withPunct).toBeGreaterThan(withoutPunct);
  });

  it("is deterministic for the same input", () => {
    const text = "Refactor the auth module to use token-based sessions.";
    expect(estimateTokens(text)).toBe(estimateTokens(text));
  });

  it("estimateTokensTotal sums across multiple strings and skips empties", () => {
    const total = estimateTokensTotal(["hello world", "", "foo bar baz", ""]);
    expect(total).toBe(estimateTokens("hello world") + estimateTokens("foo bar baz"));
  });

  it("supports a pluggable tokenizer via setTokenizer and getTokenizer", () => {
    const original = getTokenizer();
    // Install a fixed-count tokenizer for deterministic assertions.
    setTokenizer((text) => text.length); // 1 token per char
    expect(estimateTokens("abc")).toBe(3);
    expect(getTokenizer()).toBeDefined();
    // Restore the default BPE approximation.
    setTokenizer();
    expect(estimateTokens("abc")).not.toBe(3);
    expect(getTokenizer()).not.toBe(original === undefined ? null : undefined);
  });

  it("every estimator routing goes through the active counter", () => {
    setTokenizer(() => 7);
    expect(estimateTokens("anything")).toBe(7);
    expect(estimateTokensTotal(["x", "y", "z"])).toBe(21);
    setTokenizer();
  });
});
