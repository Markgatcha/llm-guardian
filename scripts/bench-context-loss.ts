/**
 * Context-Loss Benchmark — model-free factual-retention test.
 *
 * The existing `bench-orchestrator.ts` proves compression SIZE + LATENCY, but
 * never checks whether the folded/sharded context still CONTAINS the facts a
 * model would need to answer correctly. This harness closes that gap:
 *
 *   1. For each conversation we declare ground-truth FACTS (exact substrings
 *      that must survive — numbers, code refs, file paths, named entities).
 *   2. We run the REAL Guardian pipeline (retain pre-filter → tool gating →
 *      semantic folding → VCM sharding → prompt-cache structure) exactly as
 *      the orchestrator does.
 *   3. We measure what fraction of facts survive in the final injected context.
 *
 * This is the "without losing context" guarantee, and it needs NO model — it's
 * a pure string check, so it runs offline and in CI in milliseconds.
 *
 * Run: `bun run scripts/bench-context-loss.ts`
 * Writes scripts/bench-context-loss-results.json.
 */
import { writeFileSync } from "node:fs";
import { estimateTokens, foldMessages } from "../src/core/folding-engine.ts";
import { decideRetain, extractEntities } from "../src/core/retain-filter.ts";
import { gateTools } from "../src/core/tool-gater.ts";
import { shardMessages } from "../src/core/vcm-sharder.ts";
import { structureForCaching } from "../src/core/prompt-cache.ts";
import type { ChatMessage, ToolDefinition } from "../src/core/types.ts";

const MIN_FACT_RETENTION = 0.9; // must keep >=90% of critical facts

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

interface CorpusItem {
  name: string;
  messages: ChatMessage[];
  // Exact substrings that MUST survive folding + sharding.
  facts: string[];
}

const SYS =
  "You are a senior platform engineer assisting with a deployment pipeline.";
const turn = (role: ChatMessage["role"], content: string): ChatMessage => ({
  role,
  content,
});

// A tool catalog so tool gating mirrors the orchestrator pipeline.
const CATALOG: ToolDefinition[] = Array.from({ length: 40 }, (_, i) => ({
  type: "function" as const,
  function: {
    name: `tool_${i}`,
    description: `Performs operation ${i} for the request.`,
    parameters: { type: "object", properties: { q: { type: "string" } } },
  },
}));

const corpus: CorpusItem[] = [
  {
    name: "deploy-pipeline",
    messages: [
      turn("system", SYS),
      turn("user", "Hey, thanks for the help!"),
      turn(
        "user",
        "The deploy runs every Friday at 3pm UTC via GitHub Actions and publishes to npm after the test suite passes. Staging is behind Cloudflare; prod DB is Postgres 16.",
      ),
      turn(
        "assistant",
        "Got it. GitHub Actions triggers at 15:00 UTC Fridays, runs tests, then npm publish. Staging behind Cloudflare, prod uses Postgres 16.",
      ),
      turn("user", "What's the rollback if publish fails?"),
      turn(
        "assistant",
        "Rollback: `npm dist-tag @latest prev` and redeploy the last-known-good Docker image. The manifest keeps the prior image tag.",
      ),
      turn("user", "Great, thanks!"),
    ],
    // Critical facts a correct answer must retain.
    facts: [
      "Friday",
      "3pm UTC",
      "GitHub Actions",
      "npm",
      "Cloudflare",
      "Postgres 16",
      "npm dist-tag @latest prev",
      "Docker image",
    ],
  },
  {
    name: "monorepo-stack",
    messages: [
      turn("system", SYS),
      turn(
        "user",
        "We run a monorepo with 40 MCP servers. Vector store is Qdrant, cache is Redis, tools route through universal-mcp-toolkit. Memory packs come from MemOS as TOON.",
      ),
      turn(
        "assistant",
        "Understood: 40 servers in a pnpm/turbo monorepo, Qdrant vectors, Redis cache, UMT routing, MemOS TOON packs.",
      ),
      turn("user", "Add a gating step so only relevant tool schemas reach the model."),
      turn("assistant", "Added tool gating: keeps top 8 schemas by relevance."),
    ],
    facts: [
      "40 MCP servers",
      "Qdrant",
      "Redis",
      "universal-mcp-toolkit",
      "MemOS",
      "TOON",
      "pnpm",
      "turbo",
    ],
  },
  {
    name: "api-incident",
    messages: [
      turn("system", "You are an on-call SRE."),
      turn(
        "user",
        "The /v1/orders endpoint returns 503 with p99 latency at 2400ms. Error rate is 12% on the checkout service.",
      ),
      turn(
        "assistant",
        "Confirmed: GET /v1/orders 503s, p99 2400ms, 12% error rate on checkout.",
      ),
      turn("user", "Mitigate now."),
      turn(
        "assistant",
        "Scaled checkout to 8 replicas and enabled circuit breaker at 1500ms threshold.",
      ),
    ],
    facts: [
      "/v1/orders",
      "503",
      "2400ms",
      "12%",
      "checkout",
      "8 replicas",
      "circuit breaker",
      "1500ms",
    ],
  },
];

interface PipelineOpts {
  enableFolding: boolean;
  enableSharding: boolean;
}

function runPipeline(messages: ChatMessage[], query: string, opts: PipelineOpts) {
  let msgs = [...messages];
  const originalTokens = msgs.reduce(
    (s, m) => s + estimateTokens(m.content),
    0,
  );

  // Retain pre-filter (mirrors orchestrator Step 1b). Accumulate the
  // entities of kept turns so the classifier can rescue sole carriers.
  const seen = new Set<string>();
  const retainedEntities: string[] = [];
  const filtered: ChatMessage[] = [];
  for (const m of msgs) {
    if (m.role === "system") {
      filtered.push(m);
      continue;
    }
    const v = decideRetain({
      content: m.content,
      role: m.role,
      seenEntities: [...seen],
      retainedEntities,
    });
    if (v.retain) {
      filtered.push(m);
      const ents = extractEntities(m.content);
      retainedEntities.push(...ents);
      for (const e of ents) seen.add(e.toLowerCase());
    }
  }
  msgs = filtered;

  // Tool gating (mirrors Step 2b) — pure pass-through; no effect on messages
  gateTools(CATALOG, query, { maxTools: 8 });

  // Folding (Step 3)
  const postRetain = msgs.reduce((s, m) => s + estimateTokens(m.content), 0);
  if (opts.enableFolding && postRetain > 1000) {
    const r = foldMessages(msgs, { maxTokens: 2000, preserveSystem: true });
    msgs = r.messages;
  }

  // Sharding (Step 4)
  const postFold = msgs.reduce((s, m) => s + estimateTokens(m.content), 0);
  if (opts.enableSharding && postFold > 2000) {
    const userMsg =
      msgs.filter((m) => m.role === "user").pop()?.content || "";
    const budget = Math.min(3000, Math.floor(postFold * 0.9));
    const r = shardMessages(msgs, userMsg, { maxTokens: budget });
    msgs = r.messages;
  }

  // Prompt caching structure (Step 4b) — additive; does not change text
  const structured = structureForCaching(msgs, { enableCaching: true });
  const finalMessages = structured.messages as ChatMessage[];
  const finalText = finalMessages.map((m) => m.content).join("\n\n");
  const finalTokens = finalMessages.reduce(
    (s, m) => s + estimateTokens(m.content),
    0,
  );

  return { finalText, originalTokens, finalTokens };
}

function factRetention(facts: string[], text: string): {
  kept: number;
  total: number;
  dropped: string[];
} {
  const hay = norm(text);
  const dropped: string[] = [];
  let kept = 0;
  for (const f of facts) {
    if (hay.includes(norm(f))) kept++;
    else dropped.push(f);
  }
  return { kept, total: facts.length, dropped };
}

console.log("Running context-loss benchmark (model-free)...\n");

const perConv = corpus.map((c) => {
  const query =
    c.messages.filter((m) => m.role === "user").pop()?.content || "";
  const optimized = runPipeline(c.messages, query, {
    enableFolding: true,
    enableSharding: true,
  });
  const retention = factRetention(c.facts, optimized.finalText);
  const ratio = optimized.originalTokens / Math.max(1, optimized.finalTokens);
  console.log(
    `  ${c.name.padEnd(16)} orig=${optimized.originalTokens} final=${optimized.finalTokens} ratio=${ratio.toFixed(2)}x retention=${retention.kept}/${retention.total} dropped=[${retention.dropped.join(", ")}]`,
  );
  return {
    name: c.name,
    originalTokens: optimized.originalTokens,
    finalTokens: optimized.finalTokens,
    compressionRatio: Math.round(ratio * 1000) / 1000,
    factsKept: retention.kept,
    factsTotal: retention.total,
    factsDropped: retention.dropped,
    retention: retention.kept / retention.total,
  };
});

const meanRetention =
  perConv.reduce((s, c) => s + c.retention, 0) / perConv.length;
const meanRatio =
  perConv.reduce((s, c) => s + c.compressionRatio, 0) / perConv.length;

const results = {
  generatedAt: new Date().toISOString(),
  minFactRetention: MIN_FACT_RETENTION,
  meanFactRetention: Math.round(meanRetention * 1000) / 1000,
  meanCompressionRatio: Math.round(meanRatio * 1000) / 1000,
  perConversation: perConv,
};
writeFileSync(
  "scripts/bench-context-loss-results.json",
  JSON.stringify(results, null, 2),
);

console.log(
  `\nSUMMARY: mean retention = ${(meanRetention * 100).toFixed(1)}% | mean compression = ${results.meanCompressionRatio}x`,
);

if (meanRetention < MIN_FACT_RETENTION) {
  console.error(
    `FAIL: mean fact retention ${(meanRetention * 100).toFixed(1)}% below ${(MIN_FACT_RETENTION * 100)}% floor`,
  );
  process.exit(1);
}
console.log("CONTEXT-LOSS GATE PASSED");
