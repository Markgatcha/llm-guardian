/**
 * v1.6.26 module micro-benchmarks.
 *
 * The main bench.ts covers folding + tool fusion (which existed before this
 * release). This harness exercises the four new v1.6.26 modules so the
 * before/after comparison doc has real numbers for each:
 *   - token-counter (BPE estimator vs naive char/4)
 *   - retain-filter (Hermes-style gate)
 *   - tool-gater (catalog trimming)
 *   - prompt-cache (stable-prefix structuring)
 *
 * Writes scripts/bench-results-v1626-AFTER.json.
 */
import { writeFileSync } from "node:fs";
import { estimateTokens, estimateTokensTotal } from "../src/core/token-counter";
import {
  scoreRetain,
  decideRetain,
  RETAIN_THRESHOLD,
} from "../src/core/retain-filter";
import { gateTools } from "../src/core/tool-gater";
import {
  structureForCaching,
  MIN_CACHEABLE_PREFIX_TOKENS,
} from "../src/core/prompt-cache";

const SAMPLES = 1000;

function bench(fn: () => void) {
  // warmup
  for (let i = 0; i < 100; i++) fn();
  const times: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = performance.now();
    fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const p99 = times[Math.floor(times.length * 0.99)];
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  return { p50Ms: round(p50), p95Ms: round(p95), p99Ms: round(p99), meanMs: round(mean), samples: SAMPLES };
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

// ---- Fixtures ----

const TYPICAL_TURN =
  "Sure, I can help with that! Let me take a look. So what you're asking about is " +
  "the deployment pipeline. The deploy runs every Friday at 3pm UTC via GitHub Actions, " +
  "and it publishes to npm after the test suite passes. Let me know if you need anything else!";

const FILLER_TURN = "Sure! Let me know if you need anything else, happy to help!";

const SIGNAL_TURN =
  "Deploy is scheduled for Friday. The pipeline publishes to npm after tests pass.";

const LONG_CONTEXT = "The VCM sharding engine builds a context skeleton. ".repeat(80);

// Synthetic tool catalog: 40 tools, only ~4 relevant to a github-issues query.
// Matches the ToolDefinition shape the gater expects: { function: { name, description, parameters } }.
type ToolDefinition = {
  function: { name: string; description: string; parameters?: unknown };
};
const FULL_CATALOG: ToolDefinition[] = [
  "github list_issues create_issue search_repositories get_file_contents",
  "slack send_message list_channels search_messages create_channel",
  "filesystem read_file write_file list_directory move_file search_files",
  "sqlite query execute list_tables create_table backup_db",
  "linear list_issues create_issue list_projects get_team",
  "jira get_issue create_issue search_issues add_comment",
  "google_calendar list_events create_event update_event",
  "notion search_pages create_page update_page query_database",
  "aws_s3 list_buckets get_object put_object delete_object",
  "playwright navigate click screenshot fill extract_text",
]
  .join(" ")
  .split(" ")
  .map((n) => ({
    function: {
      name: n.includes("_") ? n : `${n}_tool`,
      description: `${n.replace(/_/g, " ")} operation for the integration`,
    },
  }));

const GITHUB_QUERY = "list my open github issues and triage them";

// Conversation with a long stable prefix (system + early turns) > 1024 tokens.
function longConversation(): { role: string; content: string }[] {
  const msgs: { role: string; content: string }[] = [
    { role: "system", content: "You are a helpful coding assistant. ".repeat(60) },
  ];
  for (let i = 0; i < 12; i++) {
    msgs.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Turn ${i}: ${LONG_CONTEXT.slice(0, 400)}`,
    });
  }
  msgs.push({ role: "user", content: "Summarize the deploy schedule." });
  return msgs;
}

// ---- Run ----

const results: any[] = [];

// 1. Token counter: BPE estimator vs naive char/4
{
  const bpe = bench(() => estimateTokens(LONG_CONTEXT));
  const naive = bench(() => Math.ceil(LONG_CONTEXT.length / 4));
  results.push({
    name: "token-counter-bpe",
    operation: "token-counting",
    method: "GPT-style BPE estimator",
    inputTokens: estimateTokens(LONG_CONTEXT),
    p50Ms: bpe.p50Ms,
    p95Ms: bpe.p95Ms,
    p99Ms: bpe.p99Ms,
    meanMs: bpe.meanMs,
    samples: SAMPLES,
    note: "vs naive char/4 baseline",
    naiveP50Ms: naive.p50Ms,
  });
}

// 2. Retain filter: signal turn (kept) vs filler turn (dropped)
{
  const kept = decideRetain({ content: SIGNAL_TURN, type: "assistant" });
  const dropped = decideRetain({ content: FILLER_TURN, type: "assistant" });
  const typical = decideRetain({ content: TYPICAL_TURN, type: "assistant" });
  const timing = bench(() => {
    scoreRetain({ content: TYPICAL_TURN, type: "assistant" });
  });
  results.push({
    name: "retain-filter",
    operation: "retain-scoring",
    threshold: RETAIN_THRESHOLD,
    signalTurn: { content: SIGNAL_TURN.slice(0, 40) + "...", ...kept },
    fillerTurn: { content: FILLER_TURN.slice(0, 40) + "...", ...dropped },
    typicalTurn: { content: TYPICAL_TURN.slice(0, 40) + "...", ...typical },
    p50Ms: timing.p50Ms,
    p95Ms: timing.p95Ms,
    p99Ms: timing.p99Ms,
    meanMs: timing.meanMs,
    samples: SAMPLES,
  });
}

// 3. Tool gater: 40-tool catalog trimmed to relevant subset
{
  const gated = gateTools(FULL_CATALOG, GITHUB_QUERY, { maxTools: 8 });
  const timing = bench(() => {
    gateTools(FULL_CATALOG, GITHUB_QUERY, { maxTools: 8 });
  });
  const fullSchemaTokens = estimateTokensTotal(
    FULL_CATALOG.map((t) => `${t.function.name}: ${t.function.description}`),
  );
  const keptTools = (gated.tools ?? []) as ToolDefinition[];
  const gatedSchemaTokens = estimateTokensTotal(
    keptTools.map((t) => `${t.function.name}: ${t.function.description}`),
  );
  results.push({
    name: "tool-gater",
    operation: "catalog-trimming",
    catalogSize: FULL_CATALOG.length,
    toolsSent: keptTools.length,
    toolsRemoved: gated.removed,
    fullSchemaTokens,
    gatedSchemaTokens,
    schemaTokenReduction: round(1 - gatedSchemaTokens / fullSchemaTokens),
    p50Ms: timing.p50Ms,
    p95Ms: timing.p95Ms,
    p99Ms: timing.p99Ms,
    meanMs: timing.meanMs,
    samples: SAMPLES,
  });
}

// 4. Prompt cache: stable-prefix structuring on a >1024-token conversation
{
  const conversation = longConversation();
  const structured = structureForCaching(conversation);
  const timing = bench(() => {
    structureForCaching(conversation);
  });
  results.push({
    name: "prompt-cache",
    operation: "stable-prefix-structuring",
    minCacheablePrefixTokens: MIN_CACHEABLE_PREFIX_TOKENS,
    messageCount: conversation.length,
    cachingStructured: structured.cachingStructured,
    cacheablePrefixTokens: structured.prefixTokens,
    volatileSuffixTokens: structured.suffixTokens,
    cacheEligible: structured.prefixTokens >= MIN_CACHEABLE_PREFIX_TOKENS,
    estimatedAnthropicSavingsPct:
      structured.prefixTokens >= MIN_CACHEABLE_PREFIX_TOKENS ? 90 : 0,
    p50Ms: timing.p50Ms,
    p95Ms: timing.p95Ms,
    p99Ms: timing.p99Ms,
    meanMs: timing.meanMs,
    samples: SAMPLES,
  });
}

const out = {
  generatedAt: new Date().toISOString(),
  runtime: "bun 1.4.0",
  release: "v1.6.26-new-modules",
  results,
};

writeFileSync("scripts/bench-results-v1626-AFTER.json", JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
