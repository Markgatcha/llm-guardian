import { describe, it, expect, beforeEach } from "bun:test";
import {
  foldText,
  foldMessages,
  clearFoldCache,
  foldCacheSize,
} from "./folding-engine.ts";
import { estimateTokens } from "./token-counter.ts";
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

describe("foldMessages — question safety", () => {
  const long = (s: string) => `${s} `.repeat(60);

  it("preserveLastUser leaves the final user turn byte-for-byte intact", () => {
    const question = "Remind me: which job was failing, in what region, and with what exit code?";
    const messages = [
      { role: "system" as const, content: "sys" },
      { role: "user" as const, content: long("The nightly job in eu-west-3 failed with exit code 137.") },
      { role: "assistant" as const, content: long("Please check memory usage and the container limits.") },
      { role: "user" as const, content: question },
    ];
    const out = foldMessages(messages, { preserveLastUser: true });
    expect(out.messages.at(-1)?.content).toBe(question);
  });

  it("never replaces a turn with blank text", () => {
    const messages = [
      { role: "user" as const, content: long("ok thanks, that's helpful, let me try that and get back to you") },
      { role: "assistant" as const, content: long("Sure, happy to help with that, let me think it through carefully") },
    ];
    for (const m of foldMessages(messages).messages) {
      expect(m.content.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("foldText — accuracy", () => {
  const sentencesWithPorts = (n: number) =>
    Array.from({ length: n }, (_, i) => `The ${["dev", "staging", "canary", "prod"][i % 4]} environment of the payments service listens on port ${8000 + i * 13}.`).join(" ");

  it("keeps sentences that differ only in a number (dedup must not merge facts)", () => {
    const r = foldText(sentencesWithPorts(12), { maxTokens: 4000 });
    for (let i = 0; i < 12; i++) expect(r.foldedPrompt).toContain(String(8000 + i * 13));
  });

  it("collapses a true duplicate", () => {
    const s = "The deploy finished without any errors on the batch cluster.";
    const r = foldText(`${s} ${s} ${s} Then we moved on to the next item.`, { maxTokens: 4000 });
    expect(r.foldedPrompt.split(s).length - 1).toBe(1);
  });

  it("keeps the sentence that answers the question under a tight budget", () => {
    const filler = Array.from({ length: 30 }, (_, i) => `Note ${i}: the weekly planning meeting covered scheduling topic number ${i}.`);
    filler.splice(17, 0, "The database password rotation happens every 90 days.");
    const r = foldText(filler.join(" "), { maxTokens: 60, query: "How often does password rotation happen?" });
    expect(r.foldedPrompt).toContain("90 days");
  });

  it("includes the question in the cache key", () => {
    const text = "Alpha is configured on port 1111. Beta is configured on port 2222. Gamma is configured on port 3333. ".repeat(1) + "Delta uses port 4444 for the admin panel and nothing else at all.";
    const a = foldText(text, { maxTokens: 22, query: "alpha port" });
    const b = foldText(text, { maxTokens: 22, query: "delta admin panel" });
    expect(a.foldedPrompt).not.toBe(b.foldedPrompt);
  });

  it("does not corrupt hyphenated compounds", () => {
    const r = foldText("We adopted a just-in-time build process because the old one was slow.", { maxTokens: 4000 });
    expect(r.foldedPrompt).toContain("just-in-time");
  });

  it("never makes a sentence more expensive (no contraction rewrites)", () => {
    const text = "We do not deploy on Fridays and it is not negotiable because they are on call.";
    const r = foldText(text, { maxTokens: 4000 });
    expect(estimateTokens(r.foldedPrompt)).toBeLessThanOrEqual(estimateTokens(text));
  });

  it("detects actions by whole word, not substring", () => {
    expect(foldText("Send the address to the truncated prefix handler.").metadata.actions).toEqual(["send"]);
    expect(foldText("We are deploying and reviewed the cache.").metadata.actions).toEqual(["deploy", "review", "cache"]);
  });

  it("stays fast on pathological input (no catastrophic backtracking)", () => {
    for (const text of ["x".repeat(200_000), "a.t".repeat(70_000), "src/".repeat(50_000)]) {
      const t0 = performance.now();
      foldText(text, { maxTokens: 200 });
      expect(performance.now() - t0).toBeLessThan(2000);
    }
  });

  it("scales roughly linearly with input size", () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => `Item ${i} was reviewed on day ${i % 300} for release ${i % 97} by the owner.`).join(" ");
    const time = (text: string) => {
      const xs: number[] = [];
      for (let i = 0; i < 3; i++) {
        clearFoldCache();
        const t0 = performance.now();
        foldText(text, { maxTokens: 500 });
        xs.push(performance.now() - t0);
      }
      return xs.sort((a, b) => a - b)[1] as number;
    };
    const small = time(make(500));
    const big = time(make(4000)); // 8x the text
    // Linear would be ~8x; quadratic ~64x. Allow generous noise.
    expect(big / Math.max(small, 0.5)).toBeLessThan(30);
  });
});
