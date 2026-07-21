import { describe, it, expect } from "bun:test";
import {
  getModelFingerprint,
  getAllFingerprints,
  getCheapestModel,
  reorderPromptForModel,
} from "../providers/fingerprints.ts";

describe("fingerprints", () => {
  it("looks up a registered fingerprint by full and short name", () => {
    const full = getModelFingerprint("anthropic/claude-4-opus");
    expect(full).toBeDefined();
    expect(full?.provider).toBe("anthropic");
    // Short name (after the '/') is also registered.
    const short = getModelFingerprint("claude-4-opus");
    expect(short).toBe(full);
  });

  it("returns undefined for an unknown model", () => {
    expect(getModelFingerprint("nonexistent/model-x")).toBeUndefined();
  });

  it("getAllFingerprints returns every registered model", () => {
    const all = getAllFingerprints();
    expect(all.length).toBeGreaterThan(10);
    expect(all.some((f) => f.modelName === "openai/gpt-5-turbo")).toBe(true);
  });

  it("getCheapestModel respects vision requirement", () => {
    const cheapestVision = getCheapestModel({ needsVision: true });
    expect(cheapestVision).toBeDefined();
    expect(cheapestVision?.supportsVision).toBe(true);
  });

  it("getCheapestModel respects tool-use requirement", () => {
    const cheapestTools = getCheapestModel({ needsToolUse: true });
    expect(cheapestTools?.supportsToolUse).toBe(true);
  });

  it("getCheapestModel respects a minimum context window", () => {
    const big = getCheapestModel({ minContextWindow: 1_000_000 });
    expect(big).toBeDefined();
    expect(big!.contextWindow).toBeGreaterThanOrEqual(1_000_000);
  });

  it("getCheapestModel returns the lowest input-cost capable model", () => {
    const cheapest = getCheapestModel();
    // local/auto has $0 input cost and is always capable → it should win.
    expect(cheapest?.modelName).toBe("local/auto");
  });

  it("reorderPromptForModel orders sections by priority and truncates", () => {
    const sections = new Map<string, string>([
      ["system", "SYSTEM CONTENT"],
      ["query", "THE QUESTION"],
      ["context", "x".repeat(5000)],
    ]);
    const ordered = reorderPromptForModel("anthropic/claude-4-opus", sections);
    // System (priority 1) comes first, then context, then query.
    const sysIdx = ordered.indexOf("SYSTEM CONTENT");
    const qIdx = ordered.indexOf("THE QUESTION");
    expect(sysIdx).toBeGreaterThanOrEqual(0);
    expect(sysIdx).toBeLessThan(qIdx);
    // The huge context section is truncated to its maxLength.
    const ctxPart = ordered.slice(ordered.indexOf("xxxx"));
    expect(ctxPart.length).toBeLessThanOrEqual(3000 + 5);
  });

  it("reorderPromptForModel tolerates an unknown model (falls back to default structure)", () => {
    const sections = new Map<string, string>([["system", "S"]]);
    const ordered = reorderPromptForModel("unknown/model", sections);
    expect(ordered).toContain("S");
  });
});
