import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  configure,
  selectModel,
  complete,
} from "../providers/openrouter-adapter.ts";

// Keep a reference so we can restore the real fetch after each test.
let realFetch: typeof fetch;

beforeEach(() => {
  realFetch = globalThis.fetch;
  // Reset adapter config to defaults between tests.
  configure({ apiKey: "test-key", baseUrl: "https://openrouter.ai/api/v1", skipAuth: false });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetchOnce(body: unknown, status = 200) {
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("openrouter-adapter", () => {
  describe("selectModel", () => {
    it("returns the requested model when it is not an auto alias", () => {
      expect(selectModel("anthropic/claude-4-opus")).toBe("anthropic/claude-4-opus");
    });

    it("auto-routes 'auto' to a concrete capability-matched model", () => {
      const chosen = selectModel("auto", { needsVision: true });
      expect(chosen).not.toBe("auto");
      // The chosen model must support vision.
      const { getModelFingerprint } = require("../providers/fingerprints.ts");
      expect(getModelFingerprint(chosen)?.supportsVision).toBe(true);
    });

    it("auto-routes 'router:auto' to a concrete model", () => {
      const chosen = selectModel("router:auto");
      expect(chosen).not.toContain("auto");
    });

    it("falls back to gpt-4o-mini when no candidates match", () => {
      // A wildly oversized maxTokens eliminates all fingerprints.
      const chosen = selectModel("auto", { maxTokens: 10_000_000 });
      expect(chosen).toBe("openai/gpt-4o-mini");
    });
  });

  describe("configure", () => {
    it("auto-enables skipAuth for local base URLs", async () => {
      configure({ baseUrl: "http://localhost:1234/v1", skipAuth: false });
      // A request to a local runtime should not throw for a missing key.
      mockFetchOnce({ id: "x", choices: [{ message: { content: "hi" } }], usage: {} });
      // Should not throw "API key not configured".
      const res = await complete({ model: "local/auto", messages: [] });
      expect(res.content).toBe("hi");
    });

    it("requires an api key for non-local remotes", async () => {
      configure({ apiKey: "", baseUrl: "https://openrouter.ai/api/v1", skipAuth: false });
      await expect(
        complete({ model: "anthropic/claude-4-opus", messages: [] }),
      ).rejects.toThrow(/API key not configured/);
    });
  });

  describe("complete", () => {
    it("maps the OpenAI-style response into a CompletionResponse", async () => {
      mockFetchOnce({
        id: "resp-1",
        model: "anthropic/claude-4-opus",
        choices: [
          {
            message: { content: "Hello from the model.", tool_calls: [] },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const res = await complete({
        model: "anthropic/claude-4-opus",
        messages: [{ role: "user", content: "hi" }],
      });
      expect(res.content).toBe("Hello from the model.");
      expect(res.usage.promptTokens).toBe(10);
      expect(res.usage.completionTokens).toBe(5);
      expect(res.finishReason).toBe("stop");
    });

    it("parses tool calls from the response", async () => {
      mockFetchOnce({
        id: "resp-2",
        model: "openai/gpt-5-turbo",
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "get_weather", arguments: '{"city":"SF"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });

      const res = await complete({
        model: "openai/gpt-5-turbo",
        messages: [{ role: "user", content: "weather?" }],
      });
      expect(res.toolCalls).toHaveLength(1);
      expect(res.toolCalls![0].function.name).toBe("get_weather");
    });

    it("throws on a non-OK HTTP status", async () => {
      mockFetchOnce({ error: "rate limited" }, 429);
      await expect(
        complete({ model: "openai/gpt-5-turbo", messages: [] }),
      ).rejects.toThrow(/OpenRouter API error 429/);
    });

    it("attaches the token-efficient-tools beta header when requested", async () => {
      let capturedHeaders: Record<string, string> = {};
      globalThis.fetch = (async (_url: string, init: RequestInit) => {
        capturedHeaders = (init.headers as Record<string, string>) || {};
        return new Response(
          JSON.stringify({
            id: "r",
            choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
            usage: {},
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      await complete({
        model: "anthropic/claude-4-opus",
        messages: [{ role: "user", content: "x" }],
        tokenEfficientTools: true,
      });
      expect(capturedHeaders["anthropic-beta"]).toBe("token-efficient-tools-2025");
    });
  });
});
