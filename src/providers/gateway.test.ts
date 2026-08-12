import { describe, it, expect, afterEach } from "bun:test";
import {
	ProviderGateway,
	detectProvider,
	stripProviderPrefix,
} from "./gateway.ts";
import {
	resolveModelFingerprint,
	clearModelCache,
} from "./dynamic-models.ts";
import { getAllFingerprints } from "./fingerprints.ts";

// ─── detectProvider tests ────────────────────────────────────────────────────

describe("detectProvider (latest models)", () => {
  it("detects latest Claude models", () => {
    expect(detectProvider("anthropic/claude-opus-4.8")).toBe("anthropic");
    expect(detectProvider("anthropic/claude-sonnet-5")).toBe("anthropic");
    expect(detectProvider("anthropic/claude-opus-4.7")).toBe("anthropic");
    expect(detectProvider("anthropic/claude-opus-4.5")).toBe("anthropic");
  });

  it("detects latest GPT-5.6 variants", () => {
    expect(detectProvider("openai/gpt-5.6-sol")).toBe("openai");
    expect(detectProvider("openai/gpt-5.6-terra")).toBe("openai");
    expect(detectProvider("openai/gpt-5.6-luna")).toBe("openai");
    expect(detectProvider("openai/gpt-5.5-pro")).toBe("openai");
    expect(detectProvider("openai/gpt-5.3-codex")).toBe("openai");
  });

  it("detects bare model names", () => {
    expect(detectProvider("gpt-5.6-sol")).toBe("openai");
    expect(detectProvider("claude-opus-4.8")).toBe("anthropic");
  });
});

// ─── stripProviderPrefix tests ───────────────────────────────────────────────

describe("stripProviderPrefix (latest models)", () => {
  it("strips provider prefixes from latest models", () => {
    expect(stripProviderPrefix("openai/gpt-5.6-sol")).toBe("gpt-5.6-sol");
    expect(stripProviderPrefix("anthropic/claude-opus-4.8")).toBe("claude-opus-4.8");
    expect(stripProviderPrefix("anthropic/claude-sonnet-5")).toBe("claude-sonnet-5");
  });
});

// ─── Static fingerprints tests ───────────────────────────────────────────────

describe("fingerprints", () => {
  it("includes latest Claude models", () => {
    const fps = getAllFingerprints();
    const models = fps.map((f: { modelName: string }) => f.modelName.toLowerCase());
    expect(models).toContain("anthropic/claude-opus-4.8");
    expect(models).toContain("anthropic/claude-sonnet-5");
    expect(models).toContain("anthropic/claude-opus-4.7");
  });

  it("includes latest GPT models", () => {
    const fps = getAllFingerprints();
    const models = fps.map((f: { modelName: string }) => f.modelName.toLowerCase());
    expect(models).toContain("openai/gpt-5.6-sol");
    expect(models).toContain("openai/gpt-5.5-pro");
    expect(models).toContain("openai/gpt-5.3-codex");
  });
});

// ─── Dynamic model resolution tests ───────────────────────────────────────────

describe("dynamic model resolution", () => {
  afterEach(() => {
    clearModelCache();
  });

  it("falls back to static fingerprints for known models", async () => {
    // This should work without API access — falls back to static fingerprints.
    const fp = await resolveModelFingerprint("anthropic/claude-opus-4.8");
    expect(fp).not.toBeNull();
    expect(fp!.modelName).toBe("anthropic/claude-opus-4.8");
    expect(fp!.provider).toBe("anthropic");
  });

  it("returns null for unknown models (when API is unavailable)", async () => {
    // This model doesn't exist in static fingerprints.
    // If the API is available, it might return a result; if not, we get null.
    const fp = await resolveModelFingerprint("nonexistent/model-9.9");
    // Could be null (no match) or non-null (API returned it).
    // Either way, it should not throw.
    if (fp !== null) {
      expect(fp!.modelName).toBe("nonexistent/model-9.9");
    }
  });
});


// ─── Dynamic pricing tests ───────────────────────────────────────────────────

describe("ProviderGateway dynamic pricing", () => {
  const gateway = new ProviderGateway();
  it("falls back to static fingerprints for getModelPricing", async () => {
    const pricing = await gateway.getModelPricing("anthropic/claude-opus-4.8");
    expect(pricing).not.toBeNull();
    if (pricing) {
      expect(pricing.inputCostPerMillion).toBeGreaterThan(0);
      expect(pricing.outputCostPerMillion).toBeGreaterThan(0);
    }
  });
});
