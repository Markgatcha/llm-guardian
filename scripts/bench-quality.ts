/**
 * Quality (Answer-Fidelity) Benchmark — online A/B against a local model.
 *
 * `bench-context-loss.ts` proves the facts SURVIVE in the optimized context.
 * This harness proves the model can still ANSWER correctly when those facts are
 * delivered via the folded + sharded context. For each task we send the SAME
 * conversation to the local model twice — once RAW, once through Guardian's
 * real pipeline (retain → fold → shard) — and measure:
 *
 *   - keyword recall: expected facts present in the answer (raw vs optimized)
 *   - answer-F1: bag-of-words similarity between the two answers
 *
 * THE GATE IS THE DELTA, NOT ABSUTE RECALL, AND IT IS TRIAL-AVERAGED.
 * A local reasoning model (e.g. Gemma 4 E2B) is non-deterministic
 * even at temperature 0 — it sometimes spends its token budget on
 * reasoning_content and returns an empty answer, and raw recall varies
 * run-to-run. So we run N trials per arm and compare the MEAN recall.
 * This isolates "did folding/sharding hurt?" from "is the local model
 * weak / noisy?" — and stops the gate from flapping on model variance.
 *
 * Tasks mix short (pipeline no-op) and LONG (folding + sharding actually
 * fire, because the corpus exceeds the 1000/2000-token gates) conversations,
 * so the real compression path is exercised — not just the retain filter.
 *
 * Requires a running local model (e.g. LM Studio at http://127.0.0.1:1234/v1).
 * Run: `bun run scripts/bench-quality.ts`
 * Env: MODEL (default google/gemma-4-e2b), BASE_URL, MAX_TOKENS (900),
 *      TRIALS (default 3). Writes scripts/bench-quality-results.json.
 */
import { writeFileSync } from "node:fs";
import { estimateTokens, foldMessages } from "../src/core/folding-engine.ts";
import { decideRetain, extractEntities } from "../src/core/retain-filter.ts";
import { gateTools } from "../src/core/tool-gater.ts";
import { shardMessages } from "../src/core/vcm-sharder.ts";
import { structureForCaching } from "../src/core/prompt-cache.ts";
import { configure, complete } from "../src/providers/openrouter-adapter.ts";
import type { ChatMessage } from "../src/core/types.ts";

const MODEL = process.env.MODEL || "google/gemma-4-e2b";
const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:1234/v1";
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || "400", 10);
const TRIALS = Math.max(1, parseInt(process.env.TRIALS || "3", 10));
// Optimized mean recall may not fall more than this below the raw mean recall.
const DELTA_FLOOR = -0.05;

// Point the real adapter at the local runtime (no API key required).
// Reasoning mode is env-driven so we can benchmark ON vs OFF:
//   GUARDIAN_REASONING=none|off  -> CoT disabled (fast, deterministic)
//   GUARDIAN_REASONING=on   -> provider default (reasoning on)
//   unset                      -> adapter default (none for local)
const REASONING_ENV = (process.env.GUARDIAN_REASONING || "none").toLowerCase();
const benchReasoning =
  REASONING_ENV === "on"
    ? undefined
    : REASONING_ENV === "off" || REASONING_ENV === "none"
      ? { effort: "none" as const }
      : undefined;
configure({ apiKey: "local", baseUrl: BASE_URL, skipAuth: true, reasoning: benchReasoning });

const SYS =
  "You are a senior platform engineer. Answer the user's question using ONLY the conversation above. Be concise.";
const turn = (role: ChatMessage["role"], content: string): ChatMessage => ({
  role,
  content,
});

interface Task {
  name: string;
  messages: ChatMessage[];
  expectedKeywords: string[];
}

// ── Short tasks (pipeline is a no-op; baseline for model strength) ──
const shortTasks: Task[] = [
  {
    name: "stack-components",
    messages: [
      turn("system", SYS),
      turn(
        "user",
        "We run a monorepo with 40 MCP servers. Vector store is Qdrant, cache is Redis, tools route through universal-mcp-toolkit. Memory packs come from MemOS as TOON.",
      ),
      turn("assistant", "Noted."),
      turn("user", "List the core infrastructure components in our stack."),
    ],
    expectedKeywords: ["qdrant", "redis", "universal-mcp-toolkit", "memos", "toon"],
  },
  {
    name: "config-detail",
    messages: [
      turn("system", SYS),
      turn(
        "user",
        "Our rate-limit config uses `limit: 1000`, `window: 60s`, and `retry: 3` for the public API.",
      ),
      turn("assistant", "Logged."),
      turn("user", "What are the rate-limit settings for the public API?"),
    ],
    expectedKeywords: ["1000", "60s", "retry", "3"],
  },
];

// ── LONG task: a genuinely long (3500+ token) multi-turn design doc so
// folding AND sharding actually fire (gates at >1000 / >2000 tokens after
// the retain pre-filter). Fact-bearing turns are substantive (they survive
// retain); filler is short (it gets pruned). The final question asks for two
// facts that each appear exactly once (sole carriers) — testing the rescue
// logic end-to-end under real compression.
function longConversation(): ChatMessage[] {
  // Substantive, fact-dense turns. Each carries a unique high-value entity
  // (file path / url / metric / step verb) so the retain filter keeps it and
  // so sole-carrier rescue is exercised when compression prunes the rest.
  // Each fact is padded to a realistic paragraph length so the corpus crosses
  // the folding (>1000) and sharding (>2000) gates after retain.
  const rawFacts: string[] = [
    "The deploy service is a Go binary built from `deploy/svc/main.go` and it talks to a Postgres 16 database configured in `db/postgres.yaml`. The connection pool is capped at 20 and uses `pgx` with prepared statements for the hot path, and we set a 5s statement timeout so a slow query can never block the worker.",
    "We cache user sessions in Redis via `cache/redis.conf`; the default TTL is 3600s and we use the `ioredis` client with a sentinel for HA. The CI pipeline lives in `ci/github-actions.yml` and runs `bun test` then `bun run build` on every push to main, uploading the resulting image to the registry with the commit sha as the tag.",
    "Build artifacts ship to S3 under the `builds/` prefix keyed by git sha. The runtime health endpoint is GET /healthz and the prometheus metrics endpoint is GET /metrics; both are scraped every 15s by the cluster agent and feed the SLO dashboards that the on-call rotation watches.",
    "Rollbacks use `kubectl rollout undo deploy/deploy-svc` and we tag the previous image as `deploy-svc:prev` before any new deploy. Alerting fires to the `https://hooks.slack.com/alerts` webhook and pages on-call if error rate exceeds 2% for 5m, so a bad release is caught within the first few minutes of traffic.",
    "The embeddings service listens on `embed/port.txt` and loads the `nomic-embed-text` model at fp16; it serves 768-dim vectors into Qdrant collection `memos-prod`. Latency budget is 1500ms p99 and the error budget is 0.5% per rolling 28d window, which we track as a burn-rate alert in the observability stack.",
    "The API gateway is `gateway/envoy.yaml` (Envoy 1.29) fronting the services with a 30s upstream timeout and a 1000rps global rate limit enforced via `limit: 1000` and `window: 60s`. Retries use `retry: 3` with exponential backoff capped at 2s, and we shed load with a 429 once the budget is exhausted rather than queueing indefinitelly.",
    "The memory layer is MemOS; packs arrive as TOON blobs from `memos/packer.ts` and are cached in Redis under `memos:pack:<id>`. The vector index is rebuilt nightly at 02:00 UTC via `scripts/reindex.ts` which takes ~12m and is idempotent so a crash simply restarts from the last checkpoint without duplicating work.",
    "We run 8 replicas of the deploy service behind the gateway and autoscale on CPU > 70% with a max of 32. The canary step shifts 10% traffic for 10m and auto-promotes if p99 stays under 1500ms; otherwise it `kubectl rollout undo`s and opens a incident so a human reviews the regression before we try again.",
    "Secrets are mounted from `secrets/vault-agent.hcl` (HashiCorp Vault) and rotated every 24h. The public TLS cert is `certs/leaf.pem` renewed by `certs/renew.ts` 30d before expiry; we alert if expiry < 14d so there is always a two-week runway to fix a renewal failure before it becomes an outage.",
    "The observability stack is `otel/collector.yaml` shipping traces to Tempo, metrics to Prometheus, and logs to Loki. Dashboards live in `grafana/dashboards/` and the SLO burn-rate alert is `grafana/slo.yaml`, wired so a single pane shows the golden signals for every service in one place.",
    "Batch jobs run in `jobs/cron/` via the `kube-cron` operator: `jobs/summary.ts` at 06:00 UTC and `jobs/cleanup.ts` at 23:00 UTC. Each job has a 45m deadline and a `retry: 3` policy before it marks the run failed in `jobs/state.json`, which the morning report reads to flag any overnight breakage.",
    "The local dev loop uses `dev/docker-compose.yml` bringing up Postgres, Redis, Qdrant and the gateway; `dev/seeds.ts` loads 50k fixture rows into `db/seed.sql` so integration tests hit a realistic shape. CI mirrors this with `ci/compose.override.yml` so the test environment matches production topology as closely as the budget allows.",
    // Six extra facts to push the corpus past the sharding gate.
    "Feature flags are defined in `flags/launchdarkly.yaml` and evaluated by the `flags/sdk.ts` client with a 30s local cache; we gate the new checkout flow behind `checkout-v2` and ramp it 1% to 100% over three days while watching the conversion dashboard for a dip.",
    "The search service indexes into Elasticsearch via `search/index.ts`, which bulk-loads 200 docs per request and runs a nightly `search/reindex.ts` at 03:00 UTC; query latency is budgeted at 200ms p95 and we fall back to the cached popular-results set if the cluster is red.",
    "Billing runs through Stripe using the `billing/webhook.ts` handler, which is idempotent on event id and writes ledger rows to `billing/ledger.sql`; we reconcile against Stripe nightly and page if the settled amount diverges from our books by more than 0.01%.",
    "The mobile API is served by `mobile/router.ts` behind the same gateway, with a separate `mobile/ratelimit.yaml` of 100rps per device; responses are compressed with brotli and we cap payloads at 256kb to protect low-bandwidth users on the edge.",
    "Audit logging writes to `audit/log.ts` which streams to a write-once S3 bucket retained for 7 years; every privileged action carries a trace id and we sample 5% of reads into the same stream so investigations have full context without paying to store everything.",
    "The ML training pipeline launches via `ml/train.ts` on a spot GPU pool, checkpointing to `ml/checkpoints/` every 500 steps and notifying `https://hooks.slack.com/ml` on completion; a failed run auto-requeues once before paging the ML on-call.",
  ];
  // Pad shorter facts so every turn is a realistic paragraph and the total
  // corpus crosses the compression gates.
  const pad = (s: string): string => {
    const min = 150;
    if (s.length >= min) return s;
    return (
      s.replace(/\.$/, "") +
      ". This is tracked in the service runbook and surfaced on the team's weekly review so the operational detail stays fresh and nobody has to reverse-engineer it from the source when an incident happens at 3am."
    );
  };
  const facts = rawFacts.map(pad);
  const filler = [
    "Thanks, that makes sense.",
    "Got it, appreciate the help.",
    "Okay great, let me know if anything else changes.",
    "Sounds good to me, thanks.",
  ];
  const blocks: string[] = [];
  for (let i = 0; i < facts.length; i++) {
    blocks.push(facts[i]);
    // Greeting/ack filler the retain filter SHOULD prune.
    blocks.push(filler[i % filler.length]);
    // Occasionally restate the previous fact as a low-signal acknowledgement
    // so novelty scoring is exercised.
    if (i > 0 && i % 3 === 0) {
      blocks.push(`So just to confirm, ${facts[i - 1].slice(0, 60)}...`);
    }
  }

  const msgs: ChatMessage[] = [turn("system", SYS)];
  // User/assistant alternate; every fact block is an assistant turn, every
  // filler is a user turn (so the user-query rule never prunes facts).
  for (let i = 0; i < blocks.length; i++) {
    msgs.push(turn(i % 2 === 0 ? "assistant" : "user", blocks[i]));
  }
  msgs.push(
    turn(
      "user",
      "What embedding model does the embeddings service use, what is the latency budget, and which file defines the rate limit?",
    ),
  );
  return msgs;
}

const longTask: Task = {
  name: "long-architecture-recall",
  messages: longConversation(),
  expectedKeywords: [
    "nomic-embed-text",
    "1500ms",
    "gateway/envoy.yaml",
  ],
};

const tasks: Task[] = [...shortTasks, longTask];

function runPipeline(messages: ChatMessage[], query: string): ChatMessage[] {
  let msgs = [...messages];
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
  gateTools([], query, { maxTools: 8 });
  const postRetain = msgs.reduce((s, m) => s + estimateTokens(m.content), 0);
  if (postRetain > 1000) {
    msgs = foldMessages(msgs, { maxTokens: 2000, preserveSystem: true }).messages;
  }
  const postFold = msgs.reduce((s, m) => s + estimateTokens(m.content), 0);
  if (postFold > 2000) {
    const userMsg =
      msgs.filter((m) => m.role === "user").pop()?.content || "";
    msgs = shardMessages(msgs, userMsg, {
      maxTokens: Math.min(3000, Math.floor(postFold * 0.9)),
    }).messages;
  }
  const structured = structureForCaching(msgs, { enableCaching: true });
  return structured.messages as ChatMessage[];
}

function tokSet(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1),
  );
}

function f1(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const p = inter / a.size;
  const r = inter / b.size;
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}

function keywordRecall(answer: string, keywords: string[]): number {
  const a = answer.toLowerCase();
  const hit = keywords.filter((k) => a.includes(k.toLowerCase()));
  return hit.length / keywords.length;
}

async function answer(messages: ChatMessage[]): Promise<string> {
  const res = await complete({
    model: MODEL,
    messages,
    temperature: 0,
    maxTokens: MAX_TOKENS,
    // Reasoning mode is env-driven (see configure above) so we can
    // benchmark ON vs OFF. We do NOT force it off for gemma here.
    reasoning: benchReasoning,
  });
  return res.content || "";
}

console.log(
  `Running quality benchmark against ${MODEL} @ ${BASE_URL} (max_tokens=${MAX_TOKENS}, trials=${TRIALS})...\n`,
);

const perTask = [];
let allPass = true;
for (const t of tasks) {
  const query =
    t.messages.filter((m) => m.role === "user").pop()?.content || "";
  const rawMsgs = t.messages;
  const optMsgs = runPipeline(t.messages, query);

  // Average over TRIALS to cancel model non-determinism.
  let rawSum = 0;
  let optSum = 0;
  let f1Sum = 0;
  for (let i = 0; i < TRIALS; i++) {
    const [rawAns, optAns] = await Promise.all([
      answer(rawMsgs),
      answer(optMsgs),
    ]);
    rawSum += keywordRecall(rawAns, t.expectedKeywords);
    optSum += keywordRecall(optAns, t.expectedKeywords);
    f1Sum += f1(tokSet(rawAns), tokSet(optAns));
  }
  const rawRecall = rawSum / TRIALS;
  const optRecall = optSum / TRIALS;
  const sim = f1Sum / TRIALS;
  const delta = optRecall - rawRecall;

  const ok = delta >= DELTA_FLOOR;
  if (!ok) allPass = false;

  console.log(
    `  ${t.name.padEnd(22)} raw=${(rawRecall * 100).toFixed(0)}% opt=${(optRecall * 100).toFixed(0)}% delta=${(delta * 100).toFixed(0)}pp f1=${sim.toFixed(2)} ${ok ? "OK" : "FAIL"}`,
  );
  perTask.push({
    name: t.name,
    rawMeanKeywordRecall: Math.round(rawRecall * 1000) / 1000,
    optMeanKeywordRecall: Math.round(optRecall * 1000) / 1000,
    deltaRecall: Math.round(delta * 1000) / 1000,
    meanAnswerF1: Math.round(sim * 1000) / 1000,
    trials: TRIALS,
  });
}

const worstDelta = Math.min(...perTask.map((t) => t.deltaRecall));
const meanF1 = perTask.reduce((s, t) => s + t.meanAnswerF1, 0) / perTask.length;

const results = {
  generatedAt: new Date().toISOString(),
  model: MODEL,
  baseUrl: BASE_URL,
  trials: TRIALS,
  deltaFloor: DELTA_FLOOR,
  worstDeltaRecall: Math.round(worstDelta * 1000) / 1000,
  meanAnswerF1: Math.round(meanF1 * 1000) / 1000,
  perTask,
};
writeFileSync(
  "scripts/bench-quality-results.json",
  JSON.stringify(results, null, 2),
);

console.log(
  `\nSUMMARY: worst delta = ${(worstDelta * 100).toFixed(0)}pp (floor ${(DELTA_FLOOR * 100).toFixed(0)}pp) | mean answer F1 = ${results.meanAnswerF1} | trials=${TRIALS}`,
);

if (!allPass) {
  console.error(
    "FAIL: optimizing degraded mean answer recall beyond the delta floor.",
  );
  process.exit(1);
}
console.log("QUALITY GATE PASSED (optimizing did not degrade answers, trial-averaged)");
