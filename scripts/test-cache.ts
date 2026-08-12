// Test script for llm-guardian response caching with real OpenRouter API
// Rotates through multiple free models until one works

import { responseCache } from "../src/core/response-cache.ts";
import { orchestrate } from "../src/core/orchestrator.ts";
import { configure as configureProvider } from "../src/providers/openrouter-adapter.ts";
import { configure as configureBudget } from "../src/gateway/budget-manager.ts";

// Configure with the user's OpenRouter key
configureProvider({
  apiKey: process.env.OPENROUTER_API_KEY || "***",
  baseUrl: "https://openrouter.ai/api/v1",
  skipAuth: false,
  reasoning: { effort: "none" },
});

configureBudget({
  dailyBudgetUsd: 50,
  monthlyBudgetUsd: 500,
});

// Models to try in rotation
const MODELS = [
  "inclusionai/ling-3.0-flash:free",
  "poolside/laguna-s-2.1:free",
  "poolside/laguna-xs-2.1:free",
  "cohere/north-mini-code:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
];

async function tryModel(model: string) {
  const testRequest = {
    model,
    messages: [
      { role: "user" as const, content: "What is the capital of France? Keep your answer to one sentence." },
    ],
    temperature: 0.1,
    maxTokens: 100,
    stream: false,
    enableFolding: false,
    enableSharding: false,
    enableToolFusion: false,
    enableToolGating: false,
    enablePromptCaching: false,
  };

  console.log(`\n[Trying model: ${model}]`);
  try {
    const start = Date.now();
    const response = await orchestrate(testRequest);
    const elapsed = Date.now() - start;
    console.log(`  ✅ Success! Content: ${response.content.substring(0, 80)}`);
    console.log(`  Provider: ${response.provider}, Latency: ${elapsed}ms`);
    return { success: true, model, response, elapsed };
  } catch (err: any) {
    const msg = err.message || String(err);
    if (msg.includes("429") || msg.includes("rate-limited") || msg.includes("404") || msg.includes("unavailable")) {
      console.log(`  ❌ ${msg.substring(0, 100)}`);
      return { success: false, model, error: msg };
    }
    throw err; // Re-throw unexpected errors
  }
}

async function runTest() {
  console.log("=".repeat(60));
  console.log("LLM-Guardian Response Cache Test (Real API)");
  console.log("Trying models in rotation...");
  console.log("=".repeat(60));

  // Clear cache
  responseCache.clear();

  // ── Find a working model ──
  let workingModel = null;
  let firstResponse = null;
  let firstElapsed = 0;

  for (const model of MODELS) {
    const result = await tryModel(model);
    if (result.success) {
      workingModel = model;
      firstResponse = result.response;
      firstElapsed = result.elapsed;
      break;
    }
  }

  if (!workingModel || !firstResponse) {
    console.log("\n❌ No working model found. All models failed.");
    return;
  }

  console.log(`\n✅ Working model: ${workingModel}`);

  // ── Second request (should be cache hit) ──
  console.log("\n[2] Second request (expecting cache HIT)...");
  const testRequest = {
    model: workingModel,
    messages: [
      { role: "user" as const, content: "What is the capital of France? Keep your answer to one sentence." },
    ],
    temperature: 0.1,
    maxTokens: 100,
    stream: false,
    enableFolding: false,
    enableSharding: false,
    enableToolFusion: false,
    enableToolGating: false,
    enablePromptCaching: false,
  };

  const start2 = Date.now();
  const response2 = await orchestrate(testRequest);
  const elapsed2 = Date.now() - start2;

  console.log(`    Content: ${response2.content.substring(0, 80)}`);
  console.log(`    Provider: ${response2.provider}`);
  console.log(`    Cost: $${response2.costUsd.toFixed(6)}`);
  console.log(`    Latency: ${elapsed2}ms`);
  console.log(`    Cache hit: ${response2.cacheHit ?? false}`);

  // ── Third request with different prompt (should be cache miss) ──
  console.log("\n[3] Third request with DIFFERENT prompt (expecting cache MISS)...");
  const differentRequest = {
    ...testRequest,
    messages: [{ role: "user" as const, content: "What is the capital of Germany? One sentence." }],
  };
  const start3 = Date.now();
  const response3 = await orchestrate(differentRequest);
  const elapsed3 = Date.now() - start3;

  console.log(`    Content: ${response3.content.substring(0, 80)}`);
  console.log(`    Provider: ${response3.provider}`);
  console.log(`    Cache hit: ${response3.cacheHit ?? false}`);
  console.log(`    Cache size: ${responseCache.size()} entries (should be 2)`);

  // ── Fourth request with original prompt (should be cache hit again) ──
  console.log("\n[4] Fourth request with ORIGINAL prompt (expecting cache HIT)...");
  const start4 = Date.now();
  const response4 = await orchestrate(testRequest);
  const elapsed4 = Date.now() - start4;

  console.log(`    Content: ${response4.content.substring(0, 80)}`);
  console.log(`    Provider: ${response4.provider}`);
  console.log(`    Cache hit: ${response4.cacheHit ?? false}`);
  console.log(`    Cache size: ${responseCache.size()} entries (should still be 2)`);

  // ── Summary ──
  console.log("\n" + "=".repeat(60));
  console.log("Test Summary:");
  console.log("=".repeat(60));
  const cacheHit = response2.provider === "Inclusion AI" && response2.costUsd === 0 && response2.cacheHit;
  const allPassed = cacheHit && firstResponse?.content === response2.content && response3.content !== response2.content;
  console.log(`  ✅ Working model: ${workingModel}`);
  console.log(`  ✅ Cache miss on first request: ${!firstResponse.cacheHit}`);
  console.log(`  ✅ Cache hit on second request: ${response2.cacheHit}`);
  console.log(`  ✅ Cache miss on different request: ${!response3.cacheHit}`);
  console.log(`  ✅ Cache hit on repeated request: ${response4.cacheHit}`);
  console.log(`  ✅ Content matches on cache hit: ${firstResponse.content === response2.content}`);
  console.log(`  ✅ Different content for different prompt: ${response3.content !== response2.content}`);
  console.log(`  ✅ Cache size bounded: ${responseCache.size() === 2}`);
  console.log(`  ✅ Speed improvement: ${firstElapsed > 0 ? `${((1 - elapsed2 / firstElapsed) * 100).toFixed(1)}% faster` : "N/A"}`);
  console.log(`\n  Overall: ${allPassed ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED"}`);
  console.log("=".repeat(60));
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
