# LLM-Guardian v1.6.26

[![npm version](https://img.shields.io/badge/npm-coming%20soon-lightgrey?logo=npm)](https://www.npmjs.com/package/llm-guardian)
[![CI](https://github.com/Markgatcha/llm-guardian/actions/workflows/ci.yml/badge.svg)](https://github.com/Markgatcha/llm-guardian/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Glama](https://img.shields.io/badge/Glama-coming%20soon-lightgrey)](https://glama.ai)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/runtime-Bun-black?logo=bun)](https://bun.sh)
[![GitHub stars](https://img.shields.io/github/stars/Markgatcha/llm-guardian?style=social)](https://github.com/Markgatcha/llm-guardian)

**Central Nervous System of the AI Trio** — zero-config, sub-30ms token optimization with Semantic Folding, VCM Sharding, Hermes-style retain filtering, tool gating, and prompt caching.

> Part of the **AI Trio**: [MemOS](https://github.com/Markgatcha/memos) (Memory) · [Universal-MCP-Toolkit](https://github.com/Markgatcha/universal-mcp-toolkit) (Tools) · **LLM-Guardian** (Optimization)

---

## What It Does

LLM-Guardian sits between your application and LLM providers, compressing prompts by 80-95% while preserving semantic quality. v1.6.26 adds four new techniques — drawn from the [Hermes agent](https://github.com/NousResearch/hermes-agent) and the official prompt-caching betas — that cut tokens *before* a single request leaves your machine.

| Feature | Description |
|---|---|
| **Semantic Folding (EDH)** | Converts verbose text into entity-dense headlinese: `[ACTION:Refactor][TARGET:VCM]`. v1.6.26: order-preserving sentence dedup + adaptive fold ratio. |
| **VCM Sharding** | Builds context skeletons and injects only high-relevant knowledge shards. v1.6.26: semantic dedup across shards + adaptive budget cutoff. |
| **Retain Pre-Filter** *(new, v1.6.26)* | Hermes-style gate that drops low-signal content (greetings, filler, acknowledgements) before it reaches folding/sharding — ~73% of agent turns are fixed overhead. |
| **Tool Gating** *(new, v1.6.26)* | Filters the tool catalog to the handful a query actually needs before sending schemas. No-op for small catalogs; up to 14-70% schema-token savings on large ones. |
| **Prompt Caching** *(new, v1.6.26)* | Reorders the conversation into a stable prefix and stamps `cache_control` breakpoints. Anthropic ~90% off on cache hits, OpenAI 50%. Also sets the `token-efficient-tools-2025` beta header. |
| **Pluggable Token Counter** *(new, v1.6.26)* | GPT-style BPE estimator by default; `setTokenizer()` lets you drop in `tiktoken` or a provider tokenizer for exact counts. Shared with MemOS so both projects count tokens identically. |
| **AI Trio Memory Injection** *(v1.6.27)* | Pulls a token-budgeted memory slice from the memos (`@mem-os/sdk`) sibling repo and injects it as a high-relevance context shard. Activated automatically when MemOS env vars are set — no code change needed. |

## AI Trio Memory Integration

LLM-Guardian and [memos](https://github.com/Markgatcha/memos) (the AI Trio memory layer) compose at runtime. When enabled, the Guardian server builds a MemOS **TOON context pack** (60-90% smaller than JSON) for each request's user query and injects it ahead of the conversation, so the model sees grounded memory without re-deriving context from chat history.

**Activation (env-gated, zero hard dependency):** set any of these on the Guardian server process and the integration turns on automatically. Without them, Guardian runs standalone — the `@mem-os/sdk` package is never imported and there is no overhead.

| Env var | Purpose |
|---|---|
| `MEMOS_NAMESPACE` | MemOS namespace to query (e.g. `default`). Presence alone enables the integration. |
| `MEMOS_STORAGE_PATH` | Path to the MemOS SQLite store (alternative to `MEMOS_NAMESPACE`). |
| `MEMOS_EMBEDDING_PROVIDER` | Optional embedding provider URL. MemOS falls back to keyword search if omitted. |

**Behavior:**
- The pack is built **once per process** (MemOS `init()` is cached) and reused across requests.
- Failures are **soft**: if `@mem-os/sdk` isn't installed or MemOS errors, the request proceeds without memory injection (a warning is logged) — it never 500s the request.
- You can also supply a pack explicitly per request via `memory_pack` in the `/v1/chat/completions` body; an explicit pack overrides the auto-built one.
- Surfaced in metrics as `memoryPackInjected` / `memoryPackTokens`.


| **Cross-Model Fingerprinting** | Re-orders prompt components per model's attention biases (Claude 4.8, Gemini 3.1, GPT-5.5) |
| **Tool Fusion** | Compresses multiple MCP tool-turns into a single semantic block |
| **Privacy Shield** | PII redaction + prompt injection blocking (sub-millisecond) |
| **Budget Enforcement** | Per-request, daily, and monthly cost limits |
| **Smart Routing** | Selects cheapest capable model via OpenRouter |

---

## Quick Start

```bash
# Clone & install
git clone https://github.com/Markgatcha/llm-guardian.git
cd llm-guardian
bun install

# Configure
export OPENROUTER_API_KEY="<your-openrouter-key>"

# Start the Guardian API server
bun run start

# Or with options
bun run src/cli/index.ts start --port 3000 --daily-budget 50 --monthly-budget 500
```

---

## Usage

### OpenAI-Compatible Proxy

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:3000/v1",
  apiKey: "guardian-local-key",
});

const response = await client.chat.completions.create({
  model: "auto",  // Guardian picks the cheapest model
  messages: [{ role: "user", content: "Explain semantic folding" }],
});
```

### Standalone Folding

```bash
bun run src/cli/index.ts optimize "Your long text here..." --max-tokens 50
```

```typescript
import { foldText } from "./src/core/folding-engine";

const result = foldText(longText, { maxTokens: 200 });
console.log(result.metadata.compressionRatio); // e.g. 0.08 (92% reduction)
console.log(result.foldedPrompt);               // Entity-dense headlinese
```

---

## Architecture

```
Client Request
      │
      ▼
┌─────────────────────────────────────────────────────────┐
│                 Guardian Orchestrator                    │
│                                                          │
│  0. Tool Gating       → Trim catalog to relevant tools   │  ✦ v1.6.26
│  1. Privacy Shield    → PII redaction + injection block  │
│  2. Tool Fusion       → Multi-turn MCP output compression│
│  3. Semantic Folding  → EDH entity-dense distillation    │
│  4. VCM Sharding      → Context skeleton + relevance cut │
│  5. Prompt Caching    → Stable prefix + cache_control    │  ✦ v1.6.26
│  6. Budget Check      → Per-request / daily / monthly    │
│  7. Model Selection   → Cheapest capable via fingerprint │
│  8. OpenRouter Call   → Unified API adapter              │
│  9. Retain Filter     → Gate the assistant turn for reuse│  ✦ v1.6.26
│ 10. Analytics         → Cost, latency, compression logs  │
└─────────────────────────────────────────────────────────┘
      │
      ▼
   Response + Optimization Metrics
```

---

## What's New in v1.6.26

Four techniques land this release. All are **additive and opt-in via request flags** — existing calls behave exactly as before.

### Retain Pre-Filter (Hermes-style)

Agent turns are ~73% fixed overhead: greetings, acknowledgements, restatements. The retain filter scores each candidate turn on length, signal density, action verbs, and novelty, and drops anything below `RETAIN_THRESHOLD` (0.35) *before* folding or sharding runs.

```typescript
import { scoreRetain, decideRetain, setRetainClassifier } from "./src/core/retain-filter";

// Heuristic classifier (default, zero deps)
const decision = decideRetain({ content: "Sure, I can help with that!", type: "assistant" });
// → { retain: false, score: 0.08, reason: "low-signal" }

// Swap in your own scorer for domain-specific gating
setRetainClassifier((input) => ({ retain: true, score: 1, reason: "custom" }));
```

Active by default in the orchestration pipeline (Step 1b, after privacy scan and
before folding/sharding) — no flag required. The orchestrator records
`retainFilterApplied`, `retainFilterDropped`, and `retainFilterTokensSaved` in
`OptimizationMetrics` so you can audit what was dropped.

### Tool Gating

Sends only the tool schemas a query is likely to invoke. Relevance is scored on term overlap between the query and each tool's name/description; the top `maxTools` (default 8) above `RELEVANCE_FLOOR` (0.05) survive. **No-op when the catalog is already small** or the query is empty, so it's safe to leave on by default.

```typescript
// Request with 200 registered tools but a 3-word query
const { toolsSent } = await orchestrator.optimize({
  query: "list my github issues",
  tools: fullCatalog,          // 200 entries
  enableToolGating: true,
  maxTools: 8,
});
// toolsSent.length === 4   (github, list_issues, search, repository)
```

This stacks with the `token-efficient-tools-2025` beta header (see Prompt Caching), which compresses the *output* schema format itself.

### Prompt Caching

Reorders messages into a stable prefix (system → early turns) and stamps an `ephemeral` `cache_control` breakpoint on the last prefix message once it clears 1024 tokens. Anthropic charges ~10% for cache hits (~90% off), OpenAI 50%. When the model supports it, Guardian also sends the `token-efficient-tools-2025` beta header for 14-70% *output* savings.

```typescript
import { structureForCaching, MIN_CACHEABLE_PREFIX_TOKENS } from "./src/core/prompt-cache";

const { messages, breakpoints } = structureForCaching({
  messages: conversation,
  system: longSystemPrompt,
});
// breakpoints: [{ index: 12, tokens: 1480, type: "ephemeral" }]
```

Enable with `enablePromptCaching: true`. Below `MIN_CACHEABLE_PREFIX_TOKENS` (1024), the structurer is a no-op — the providers won't cache anything that small anyway.

### Pluggable Token Counter

A single BPE-style estimator backs folding budgets, VCM shard sizing, and the cache breakpoint math. The default heuristic (split on whitespace/punctuation; words ≤8 chars = 1 token, else `ceil(len/4)`) matches MemOS's `context-pack.ts` so the AI Trio counts identically. Drop in an exact counter when you need precision:

```typescript
import { setTokenizer, estimateTokens } from "./src/core/token-counter";

// Default: heuristic BPE (~5% error vs. tiktoken on English)
estimateTokens("The quick brown fox");  // → 4

// Exact: wire up tiktoken or a provider tokenizer
setTokenizer({
  count: (text) => tiktoken.encode(text).length,
});
```

### Folding & Sharding (improved)

Both core engines got additive upgrades — no rewrites:

- **Folding**: order-preserving sentence dedup (FNV-1a hash), adaptive fold ratio (0.3-0.6 based on entity density), and an adaptive headline that skips when the body is already compact (fixes the over-expansion regression).
- **VCM Sharding**: semantic dedup across shards, adaptive budget cutoff (0.1/0.15/0.25 by budget usage), enriched entity extraction (URLs, endpoints, models, metrics). `ShardingResult` now reports `shardsDeduped`, `budgetUsed`, `budgetTotal`.

---

## File Structure

```
src/
  core/                       # Optimization engine
    orchestrator.ts             # The Brain — coordinates all subsystems
    folding-engine.ts           # EDH: text → entity-dense headlinese
    vcm-sharder.ts              # Context skeleton + relevance sharding
    tool-fuser.ts               # MCP tool output compression
    types.ts                    # Shared TypeScript interfaces
  gateway/
    privacy-shield.ts           # PII scrubbing + injection detection
    budget-manager.ts           # Cost enforcement (request/daily/monthly)
  providers/                  # Provider adapters + routing
    provider-registry.ts        # Direct provider IDs, base URLs, capability metadata
    provider-router.ts          # Routes requests to the correct adapter
    router-profiles.ts          # Routing profiles (cheap / balanced / capability)
    openrouter-adapter.ts       # OpenRouter routing connector
    openrouter-catalog.ts       # OpenRouter model catalog + pricing cache
    anthropic-adapter.ts        # Direct Anthropic Claude (@anthropic-ai/sdk)
    gemini-adapter.ts           # Direct Google Gemini (@google/genai)
    openai-compatible-adapter.ts# OpenAI + OpenAI-compatible providers
    direct-provider-catalog.ts  # Direct provider fallback models
    provider-errors.ts          # Redacted provider error surfaces
    fingerprints.ts             # Model attention bias profiles (2026 models)
  cli/                        # `guardian` CLI
    index.ts                    # Entrypoint + command dispatch
    server-app.ts               # Shared Hono app factory for server + tests
    *-command.ts                # Focused command families (run, setup, models, ...)
  tui/                        # OpenTUI coding console
    index.ts                    # App loop, input precedence, render flow
    commands.ts                 # Slash-command registry
    slash-controller.ts         # `/` command dispatch + popup
    palette.ts, file-picker.ts, model-picker.ts, overlay-manager.ts, layout.ts
    sessions.ts, jobs.ts, checkpoints.ts, goals.ts, todos.ts
    mcp.ts, skills.ts, rules.ts, hooks.ts, fleet.ts, fleet-runner.ts
    theme.ts, design-system.ts, theme-tokens.ts, component-states.ts
  examples/
    folding-magic.ts            # Demo: 1k words → ~50 tokens
    mcp-handshake.ts            # Demo: MCP tool fusion
  dashboard/                  # React analytics dashboard
    App.tsx
    pages/                      # Overview, Compression, Savings, Providers, Logs
```

---

## Dashboard

The analytics dashboard provides real-time visibility into:

- **Overview** — total requests, cost, latency, tokens saved
- **Compression** — per-request folding ratios, model breakdown
- **USD Savings** — actual vs. baseline cost over time
- **Providers** — full model catalog with pricing
- **Logs** — paginated request log with cost attribution

```bash
# Build and serve the dashboard
cd src/dashboard && bun install && bun run build
bun run src/cli/index.ts dash --port 5173
```

---

## The AI Trio

| Component | Role | Status |
|---|---|---|
| **Mem-OS** | Persistent memory layer | Active |
| **Universal-MCP-Toolkit** | Tool orchestration (MCP) | Active |
| **LLM-Guardian** | Token optimization & cost control | **v1.6.26** |

Together, the Trio provides a complete local AI stack: memory, tools, and cost-optimized inference.

---

## CLI Reference

```bash
guardian setup              # First-run local setup; does not print or write secrets
guardian doctor --json      # Diagnose config, stores, MCP, agents, skills, git, siblings
guardian                    # Open the Guardian OpenTUI coding console
guardian run "fix tests"    # Run one prompt without opening the TUI
guardian run "audit this" --include src/core/orchestrator.ts --json
guardian session list       # List saved .guardian sessions
guardian session show <id>  # Show a session transcript
guardian session export <id> report.md
guardian session fork <id>
guardian models list        # Show OpenRouter model, context, and pricing cache
guardian models --refresh   # Refresh OpenRouter catalog
guardian mcp status         # Inspect real MCP config/status
guardian agent list         # List file-backed .guardian agents
guardian agent run audit "review the diff"
guardian skills list        # List .guardian skills
guardian checkpoint list    # List checkpoint snapshots
guardian checkpoint restore <id> --dry-run
guardian checkpoint restore <id> --yes
guardian jobs list          # List persisted background jobs
guardian jobs show <id>
guardian chronicle standup  # Summarize recent sessions, jobs, checkpoints, fleet
guardian chronicle reindex  # Build .guardian/chronicle/index.json
guardian pr summary         # Generate a non-mutating PR title/body/checklist
guardian start server       # Start the local API server
guardian dash               # Serve the dashboard
guardian optimize "text" -t 50
```

Inside the TUI, use `/setup` for first-run setup, `/doctor detailed` for diagnostics, `/context` for Guardian-specific context/cost state, `/btw <question>` for isolated side questions, `/review` or `/local-review` for Audit-agent diff review, `/permissions` for persisted policy profiles, `/add-dir <path>` to add approved workspace directories, `/jobs` for background work, `/agent run <name> <task>` for isolated file-backed agents, `/fleet status|jobs|inspect <id>` for read-only fleet runs, `/chronicle standup|tips|improve|reindex` for local activity summaries, and `/rollback <id> --dry-run` before any confirmed checkpoint restore.

Daily-driver polish commands include `/terminal-setup` for Windows Terminal and shell key behavior, `/keymap` and `/statusline` for local TUI controls, `/diagnostics` and `/lsp` for read-only project tooling inspection, and `/share file --format md|html` for sanitized local session export. Hosted sharing, executable hooks, writable fleet, fake memory, and unsafe undo/redo remain guarded.

---

## Quickstart

```bash
cd C:\Users\marki\llm-guardian
guardian setup --dry-run
guardian setup --profile ask --model auto
guardian doctor --json
guardian models --refresh
guardian
```

Guardian does not write provider secrets into tracked files. Set `OPENROUTER_API_KEY` in your shell or user environment.

---

## Local Providers

Guardian can route to local OpenAI-compatible runtimes without fake API keys. Use a provider-prefixed model ID so the router knows which local endpoint should receive the request.

| Provider ID | Default endpoint | Example model |
|---|---|---|
| `local` | `http://127.0.0.1:8080/v1` | `local/local-model` |
| `ollama` | `http://127.0.0.1:11434/v1` | `ollama/llama3.2` |
| `llama-cpp` | `http://127.0.0.1:8080/v1` | `llama-cpp/local-model` |
| `lmstudio` | `http://127.0.0.1:1234/v1` | `lmstudio/local-model` |

```bash
guardian auth ollama --validate
guardian run "summarize this repo" --model ollama/llama3.2
guardian auth llama-cpp --validate
guardian run "review this diff" --model llama-cpp/local-model
lms server start
lms load google/gemma-4-e2b -y --identifier google/gemma-4-e2b
guardian run "Reply with LOCAL_AI_OK only." --model lmstudio/google/gemma-4-e2b
```

Validation checks the local `/models` endpoint. Cloud provider keys are still supported, but local providers are intentionally marked no-key so Ollama, llama.cpp, LM Studio, vLLM, and LocalAI can run offline.

Set `GUARDIAN_OLLAMA_BASE_URL`, `GUARDIAN_LLAMA_CPP_BASE_URL`, `GUARDIAN_LMSTUDIO_BASE_URL`, or `GUARDIAN_LOCAL_BASE_URL` when your local OpenAI-compatible endpoint is not on the default port. Use the OpenAI-compatible `/v1` base URL, for example `http://127.0.0.1:8081/v1`.

OpenAI-compatible local providers support non-streaming and streaming Guardian requests. Use the exact model ID returned by the local `/models` endpoint; the Gemma command above is only a smoke-test example when that model is loaded in LM Studio.

---

## Direct Provider Support

Guardian routes every request through a provider adapter behind a unified `CompletionRequest` / `CompletionResponse` shape. OpenRouter remains the first-class routing catalog, but you can also target providers directly with a provider-prefixed model ID — no OpenRouter key required for those calls.

### Anthropic (`anthropic/`)

- Adapter: `src/providers/anthropic-adapter.ts` via the official `@anthropic-ai/sdk`.
- Auth: `guardian auth anthropic` or set `ANTHROPIC_API_KEY`.
- Default model: `claude-sonnet-4-6`. Use the `anthropic/` prefix, e.g. `anthropic/claude-sonnet-4-6`.
- System messages are split into Anthropic's top-level `system` field; conversation history maps to `user`/`assistant` turns.
- Provider errors are redacted through `providerSdkError` (missing key, invalid key, rate limit, etc.).

### Google Gemini (`gemini/`)

- Adapter: `src/providers/gemini-adapter.ts` via the official `@google/genai` SDK.
- Auth: `guardian auth gemini` or set `GEMINI_API_KEY`.
- Default model: `gemini-3.5-flash`. Use the `gemini/` prefix, e.g. `gemini/gemini-3.5-flash`.
- System messages become `systemInstruction`; conversation turns map to `user`/`model` roles.

### OpenAI-Compatible Adapters

- Adapter: `src/providers/openai-compatible-adapter.ts` using the `openai` SDK plus an HTTP fallback for non-OpenAI providers.
- Covers OpenAI (`openai/`), MiniMax (`minimax/`), Kimi / Moonshot (`kimi/`), Fireworks (`fireworks/`), Hugging Face (`huggingface/`), and the local runtimes (`local`, `ollama`, `llama-cpp`, `lmstudio`) documented above.
- The first-party OpenAI SDK is used for `openai/` requests; other providers use the explicit OpenAI-compatible `/chat/completions` endpoint with provider headers.
- Streaming is supported via `completeOpenAICompatibleStream` for SSE `data:` frames.
- Tool/function calls are preserved on the response when the provider returns them.

Provider IDs, base URLs, default models, and capability metadata are defined in `src/providers/provider-registry.ts`; routing profiles and the provider router (`src/providers/provider-router.ts`) select the adapter per request.

---

## Safety Model

Real today:

- Local TUI and one-shot `guardian run`
- Session, job, checkpoint, agent, skill, and MCP inspection stores
- Conservative checkpoint restore with `--dry-run` and explicit `--yes`
- Read-only fleet lane execution and job registration
- Local-only commit/PR summaries
- Chronicle local summaries from `.guardian` data

Guarded:

- Writable fleet execution
- Automatic merge
- `/undo` and `/redo`
- Real memory/MemOS mutation
- GitHub API PR creation
- Writable background jobs

---

## Chronicle

Chronicle is deterministic and local by default. It reads `.guardian/sessions`, `.guardian/jobs`, `.guardian/checkpoints`, `.guardian/fleet/runs`, `.guardian/GUARDIAN.md`, and git status. It does not send private session data to a model.

```bash
guardian chronicle reindex
guardian chronicle standup
guardian chronicle tips
guardian chronicle improve
```

`improve` suggests edits for `.guardian/GUARDIAN.md`; it does not apply them automatically.

---

## Validation

```bash
bun run typecheck
bun run lint
bun test tests\cli\commands.test.ts tests\tui\execution-safety.test.ts tests\tui\fleet-runner.test.ts tests\tui\mcp-agents-skills-checkpoints.test.ts tests\tui\chronicle-doctor-setup.test.ts
guardian doctor --json
guardian chronicle reindex
guardian chronicle standup
```

---

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/v1/chat/completions` | POST | OpenAI-compatible proxy |
| `/api/v1/stats/summary` | GET | Aggregated stats |
| `/api/v1/stats/savings` | GET | Savings analytics |
| `/api/v1/stats/compression` | GET | Compression metrics |
| `/api/v1/logs` | GET | Paginated request logs |
| `/api/v1/providers` | GET | Model catalog |
| `/api/v1/budget` | GET | Budget status |
| `/api/v1/fold` | POST | Standalone folding |
| `/health` | GET | Health check |

---

## Configuration

| Env Variable | Default | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | — | OpenRouter API key for OpenRouter routing |
| `GUARDIAN_LOCAL_API_KEY` | — | Optional key for custom local OpenAI-compatible gateways |
| `GUARDIAN_LOCAL_BASE_URL` | `http://127.0.0.1:8080/v1` | Custom local OpenAI-compatible `/v1` endpoint |
| `OLLAMA_API_KEY` | — | Optional key if your Ollama-compatible gateway requires one |
| `GUARDIAN_OLLAMA_BASE_URL` | `http://127.0.0.1:11434/v1` | Custom Ollama OpenAI-compatible `/v1` endpoint |
| `LLAMA_CPP_API_KEY` | — | Optional key if your llama.cpp server requires one |
| `GUARDIAN_LLAMA_CPP_BASE_URL` | `http://127.0.0.1:8080/v1` | Custom llama.cpp OpenAI-compatible `/v1` endpoint |
| `LMSTUDIO_API_KEY` | — | Optional key if your LM Studio gateway requires one |
| `GUARDIAN_LMSTUDIO_BASE_URL` | `http://127.0.0.1:1234/v1` | Custom LM Studio OpenAI-compatible `/v1` endpoint |
| `GUARDIAN_PORT` | `3000` | Server port |
| `DAILY_BUDGET_USD` | `50` | Daily spend cap |
| `MONTHLY_BUDGET_USD` | `500` | Monthly spend cap |
| `MAX_REQUEST_COST_USD` | `1.0` | Per-request cost limit |

---

## License

MIT — see [LICENSE](LICENSE).
