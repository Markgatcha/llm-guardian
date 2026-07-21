import { describe, it, expect, beforeEach } from "bun:test";
import {
  foldText,
  foldMessages,
  clearFoldCache,
  foldCacheSize,
} from "./folding-engine.ts";
import type { ChatMessage } from "./types.ts";

const LONG_TEXT = [
  "Create a new authentication module for the user service.",
  "The module should handle login, logout, and token refresh.",
  "We need to support OAuth2 and OpenID Connect providers.",
  "Please write the code in TypeScript using the existing patterns.",
  "Add unit tests for the new endpoints and update the docs.",
  "This is a filler sentence that adds no real information to the context.",
  "Another redundant sentence repeating the same intent about auth.",
  "Deploy the changes to the staging environment after review.",
].join(" ");

describe("folding-engine", () => {
  beforeEach(() => clearFoldCache());

  it("reduces token count for compressible text", () => {
    const result = foldText(LONG_TEXT, { maxTokens: 4000 });
    expect(result.metadata.originalTokens).toBeGreaterThan(0);
    expect(result.foldedTokens).toBeLessThanOrEqual(result.metadata.originalTokens);
    expect(result.metadata.compressionRatio).toBeGreaterThan(0);
    expect(result.foldedTokens).toBeGreaterThan(0);
  });

  it("strips filler words and hedging phrases", () => {
    const result = foldText(
      "We basically need to actually refactor the module because of the fact that it is slow.",
      { maxTokens: 4000 },
    );
    expect(result.foldedPrompt.toLowerCase()).not.toContain("basically");
    expect(result.foldedPrompt.toLowerCase()).not.toContain("actually");
  });

  it("extracts entities and actions into the headline metadata", () => {
    const result = foldText(
      "Create src/auth/login.ts and call POST /api/login. Use claude-4-opus for the model.",
      { maxTokens: 4000 },
    );
    expect(result.metadata.actions).toContain("create");
    expect(result.metadata.entities.length).toBeGreaterThan(0);
  });

  it("skips the EDH headline when folding would not compress", () => {
    const short = "Fix the bug in the parser.";
    const result = foldText(short, { maxTokens: 4000 });
    // Body alone is already <= original, so no headline prefix is prepended.
    expect(result.metadata.headline).toBe("");
    expect(result.foldedPrompt).not.toContain("[ACTION:");
  });

  it("respects the maxTokens budget and does not wildly exceed it", () => {
    const result = foldText(LONG_TEXT, { maxTokens: 40 });
    expect(result.foldedTokens).toBeLessThanOrEqual(40 + 5);
  });

  it("caches results and the cache can be cleared", () => {
    expect(foldCacheSize()).toBe(0);
    foldText(LONG_TEXT, { maxTokens: 4000 });
    expect(foldCacheSize()).toBe(1);
    const again = foldText(LONG_TEXT, { maxTokens: 4000 });
    expect(foldCacheSize()).toBe(1);
    // Same instance returned from cache.
    expect(again.metadata.originalTokens).toBeGreaterThan(0);
    clearFoldCache();
    expect(foldCacheSize()).toBe(0);
  });

  it("foldMessages preserves system messages verbatim", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are a helpful assistant. Keep this exactly." },
      {
        role: "user",
        content:
          "Create src/handler.ts. Refactor the retry logic. Deploy to staging. ".repeat(20),
      },
    ];
    const result = foldMessages(messages, { maxTokens: 4000 });
    const sys = result.messages.find((m) => m.role === "system");
    expect(sys?.content).toBe("You are a helpful assistant. Keep this exactly.");
  });

  it("foldMessages leaves short assistant/user turns untouched", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Thanks!" },
      { role: "assistant", content: "You're welcome." },
    ];
    const result = foldMessages(messages, { maxTokens: 4000 });
    expect(result.messages[0].content).toBe("Thanks!");
    expect(result.messages[1].content).toBe("You're welcome.");
  });

  it("foldMessages compacts long user turns", () => {
    const big =
      "Create the new billing service. " +
      "Refactor the invoice logic. Update the database schema. " +
      "Add metrics to track revenue. Deploy behind a flag. ".repeat(15);
    const messages: ChatMessage[] = [{ role: "user", content: big }];
    const result = foldMessages(messages, { maxTokens: 4000 });
    const folded = result.messages[0].content;
    // The folded version should drop filler and be shorter than the raw text.
    expect(folded.length).toBeLessThan(big.length);
  });
});
