import { describe, it, expect, beforeEach } from "bun:test";
import {
  scoreRetain,
  shouldRetain,
  hasAnswerSignal,
  extractEntities,
  setRetainClassifier,
  decideRetain,
} from "./retain-filter.ts";

describe("retain-filter", () => {
  beforeEach(() => setRetainClassifier(undefined));

  it("returns 0 for empty / too-short content", () => {
    expect(scoreRetain({ content: "" })).toBe(0);
    expect(scoreRetain({ content: "hi" })).toBe(0);
  });

  it("scores information-dense content above the retain threshold", () => {
    const score = scoreRetain({
      content:
        "Create src/auth/login.ts implementing OAuth2 with POST /api/login, model claude-4-opus, latency 42ms.",
    });
    expect(score).toBeGreaterThanOrEqual(0.35);
  });

  it("flags pure acknowledgements as low-signal (score ~0)", () => {
    expect(scoreRetain({ content: "ok thanks got it" })).toBeLessThan(0.1);
    const decision = shouldRetain({ content: "sounds good", role: "assistant" });
    expect(decision.retain).toBe(false);
    expect(decision.reason).toBe("low-signal acknowledgement");
  });

  it("always retains sacred user and system roles", () => {
    expect(shouldRetain({ content: "x", role: "user" }).retain).toBe(true);
    expect(shouldRetain({ content: "x", role: "system" }).retain).toBe(true);
    expect(shouldRetain({ content: "x", role: "user" }).reason).toBe("sacred role");
  });

  it("forces a keep when content carries an answer/action signal", () => {
    const content = "Rollback: npm dist-tag @latest prev and redeploy the Docker image.";
    expect(hasAnswerSignal(content)).toBe(true);
    const decision = shouldRetain({ content, role: "assistant" });
    expect(decision.retain).toBe(true);
    expect(decision.reason).toBe("answer/action signal");
  });

  it("rescues a sole carrier of a unique high-value entity", () => {
    const content = "The config lives at src/deploy/prod.yaml and costs $1200.";
    // Nothing retained yet → this is the only mention → must be kept.
    const decision = shouldRetain({
      content,
      role: "assistant",
      retainedEntities: [],
    });
    expect(decision.retain).toBe(true);
    expect(decision.reason).toBe("sole carrier of unique signal");
  });

  it("does not force-keep when the entity is already retained", () => {
    const content = "Update src/deploy/prod.yaml with the new threshold.";
    const decision = shouldRetain({
      content,
      role: "assistant",
      retainedEntities: ["src/deploy/prod.yaml"],
    });
    // Already covered by a retained turn → not rescued; falls to score.
    expect(decision.reason).not.toBe("sole carrier of unique signal");
  });

  it("extractEntities pulls file paths, urls, endpoints, and metrics", () => {
    const ents = extractEntities(
      "Edit src/a.ts, visit https://example.com, call GET /x, metric 50ms.",
    );
    expect(ents.some((e) => e === "src/a.ts")).toBe(true);
    expect(ents.some((e) => e === "https://example.com")).toBe(true);
    expect(ents.some((e) => e === "GET /x")).toBe(true);
    expect(ents.some((e) => e === "50ms")).toBe(true);
  });

  it("delegates to a custom classifier via setRetainClassifier", () => {
    setRetainClassifier((input) => ({
      retain: input.content.includes("KEEP"),
      score: 0.9,
      reason: "llm",
    }));
    expect(decideRetain({ content: "KEEP this" }).retain).toBe(true);
    expect(decideRetain({ content: "drop this" }).retain).toBe(false);
    setRetainClassifier(undefined);
  });
});
