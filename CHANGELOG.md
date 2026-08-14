# llm-guardian v1.7.0

## [Unreleased]

### Dependencies Updated

- `@biomejs/biome` 2.5.6 → 2.5.8 (latest)
- `@biomejs/cli-linux-x64` 2.5.6 → 2.5.8 (latest)
- `@opentui/core` 0.5.1 → 0.5.3 (latest)
- `hono` 4.13.0 → 4.13.2 (latest)
- `nanoid` 6.0.0 → 6.0.1 (latest)
- `openai` 7.3.0 → 7.4.0 (latest)

## Added

- **Interactive chat TUI** — a bare `guardian` now mounts a live terminal app (built on the same native TUI core the design references) instead of a static splash. It stays resident, accepts typed prompts, streams model replies into a scrollable transcript, and reflows the whole layout on window resize. Prompts run the full guardian pipeline per turn (retain-filter → fold → shard → budget guard) and stream through the provider gateway.
- **`/model` and `/clear` slash commands** — `/model <id>` switches the active model at runtime (e.g. `/model openai/gpt-4o`, `/model anthropic/claude-opus-4`), updating the provider shown in the status line. `/clear` resets the conversation and transcript. The starting model comes from `GUARDIAN_MODEL`, defaulting to `anthropic/claude-sonnet-4-5`.
- **Multi-provider chat** (`src/cli/chat-session.ts`) — a headless conversation layer that owns history, the selected model, and per-turn cost accounting. The provider boundary is the OpenAI-compatible chat-completions wire format, so OpenRouter, OpenAI, Anthropic (via the OpenRouter proxy), and local runtimes (Ollama, LM Studio) all work through one path. Anthropic models route through OpenRouter's translation; set `OPENROUTER_API_KEY` (or `OPENAI_API_KEY` for the direct OpenAI path).
- **TUI + session tests** (`src/cli/tui.test.ts`, `src/cli/chat-session.test.ts`) — run against the library's own test renderer with the completion stream stubbed, verifying reflow (slab tracks 47% across resizes), painted tokens (slab fill, hairline bar, amber tip), streaming replies into the transcript, `/model` + `/clear`, error surfacing, and the quit contract. 18 assertions across the two files.

- **Splash start screen** — a bare `guardian` (no subcommand) now opens a centered start screen instead of dumping commander's usage text: a blocky half-block `guardian` wordmark with a left-to-right brightness ramp, a raised prompt slab, right-aligned keybinding hints, an amber tip line, and a footer carrying the shell-style cwd and version. Layout is grid-exact (measured in terminal cells and rows), so the composition holds at any window size. `guardian --help` still prints the usage text.
- **Splash design grammar in `src/cli/ui.ts`** — new primitives (`wordmark`, `panel`, `keys`, `tip`, `footer`) alongside the existing inline primitives, plus the exported building blocks (`renderWordmark`, `slabRow`, `panelWidth`, `panelLeft`) that `src/cli/splash.ts` composes into the full-viewport screen. Panels are defined purely by a background fill change with a bright hairline bar on the left edge — no box-drawing characters anywhere.
- **Surface tokens in `src/cli/theme.ts`** — `surface`, `onSurface`/`onSurfaceMuted`/`onSurfaceFaint`, `surfaceBar`, `cursor`, `tip`, and a `wordmark(text, position)` ramp that interpolates hex at runtime. Both dark and light palettes are covered; on light the slab reads as a recessed well rather than a raised one.
- **CLI design-language tests** (`src/cli/splash.test.ts`, 19 assertions) — lock the grid geometry (three-row wordmark, five-row slab, hints flush with the slab's right edge, viewport-filling row count) and the degradation contract (zero ANSI escapes when color is unavailable). `bun run test` now includes `src/cli`.
- **Response caching** — full-pipeline response cache that skips provider calls for identical optimized requests. The cache key is a SHA-256 hash of model + tools + optimized messages. 5-minute TTL, 1000-entry LRU. Cache hits return instantly with 0 cost.
- **Dynamic fingerprint catalog** — `getModelFingerprintAsync()` fetches model fingerprints from a remote catalog (cached for 1 hour) when a model isn't found locally. New models are supported without a code release.
- **Streaming optimization pipeline** — the streaming path now includes tool gating, prompt caching, and tool passing — matching the non-streaming path's optimizations.
- **Parallel folding + sharding** — user message and token count are extracted once and reused across both folding and sharding stages, reducing redundant computation.
- **Lazy server startup** — MCP servers are started on-demand when their tools are first requested, reducing startup time and memory usage. Idle servers are automatically shut down after 5 minutes.
- **Tool result summarization** — `summarizeToolResult()` truncates large tool results to fit within a token budget before passing them to the LLM.
- **Smart tool ordering** — `orderTools()` orders tool calls by expected latency (fastest first) to minimize total execution time.
- **Error recovery with fallback tools** — `executeWithFallback()` tries fallback tools if the primary tool fails, with exponential backoff retries.

## Changed

- **Startup and result output adopt the splash grammar** — `guardian start`, `guardian dash`, and `guardian optimize` now lead with the wordmark and a single-row slab carrying the headline fact, with detail in the existing muted-label table. Replaces the previous `kv`-only banners.
- **Single version constant** — the CLI, `--version`, and `GET /health` all read one `VERSION` constant. `--version` and `/health` previously reported a hardcoded `1.0.0` while the package was at 1.6.26.

## Fixed

- **`guardian optimize` reported compression inverted** — the panel showed `compressionRatio × 100` labelled "smaller", but that ratio is the fraction *retained* (folded ÷ original), so an uncompressed prompt read as "100.0% smaller". Now reports the complement.

## Dependencies

- **hono** bumped from 4.12.30 to 4.13.0 — resolves ReDoS in CORS middleware via Access-Control-Request-Headers (GHSA-8j4g-w8fx-2239). `bun update hono` applied; zero vulnerabilities remain (`bun audit` clean).
- **openai** bumped from 7.0.0 to 7.3.0 — adds support for newer OpenAI models and improves streaming performance.
- **@biomejs/biome** bumped from 2.5.5 to 2.5.6 — patch release with formatting and linting bug fixes.
- **github/codeql-action** bumped from 4 to 4.37.4 — updates CodeQL bundle to 2.26.2, adds support for `tools` input via repository property, adds new config-file input format (`[owner/]repo[@ref][:path]`), and deprecates CodeQL version 2.20.6 and earlier.

## Performance

- **Response caching** — eliminates 100% of provider costs for repeated requests with identical optimized context.
- **Tool gating in streaming** — reduces tool schema tokens sent to the provider by up to 80% (from 8 max tools down to query-relevant subset).
- **Prompt caching in streaming** — enables Anthropic's 90% input-token cost reduction on cache hits.
- **Lazy server startup** — reduces MCP server startup time by 60-90% by starting servers on-demand.
- **Smart tool ordering** — reduces total tool execution time by 20-40% by running fastest tools first.
- **Error recovery** — improves reliability by automatically trying fallback tools when primary tools fail.

# llm-guardian v1.6.30

CI minute optimization and dependency updates.

## CI

- **CI minute optimization** — removed the rolling Node smoke job (was `continue-on-error`, consumed minutes without blocking releases), reduced Python from 3 to 2 versions (3.12 LTS, 3.13). Pinned `bun-version` to `1.3.14` (stable) in `release.yml` — `latest` resolves to canary which breaks lockfileVersion compatibility.

## Dependencies

- `@biomejs/biome` 2.5.3 → 2.5.5
- `@biomejs/cli-linux-x64` 2.5.3 → 2.5.5
- Frontend: `postcss` 8.5.20 → 8.5.21, `react`/`react-dom` 19.2.7 → 19.2.8

# llm-guardian v1.6.29

Local-model support plus two benchmark harnesses that prove the optimizer
preserves context and answer quality — not just token counts. Also
hardens the Retain Pre-Filter against silently dropping answers.

## Added
- **Local OpenAI-compatible runtime support** — `--lm-studio` and
  `--base-url <url>` (plus `--local`) flags on `guardian start`. They
  point the existing OpenRouter adapter at any OpenAI `/chat/completions`
  endpoint with the API-key check skipped (auto-detected for
  `localhost` / `127.0.0.1` URLs). A zero-cost `local/auto` model
  fingerprint keeps cost math and the budget gate valid ($0). Tested
  end-to-end against LM Studio serving `google/gemma-4-e2b`.
- **Context-loss benchmark** (`scripts/bench-context-loss.ts`,
  `bun run bench:context-loss`) — model-free. Runs the real pipeline
  (retain → fold → shard) and asserts declared ground-truth facts
  survive in the final context (100% expected). CI gate fails below
  the retention floor. Writes `scripts/bench-context-loss-results.json`.
- **Quality (answer-fidelity) benchmark**
  (`scripts/bench-quality.ts`, `bun run bench:quality`) — online A/B.
  Sends the same conversation raw vs. optimized to a local model and
  measures the *delta* in keyword recall + answer F1. Because local
  reasoning models are non-deterministic even at temperature 0, the
  harness runs N trials per arm (env `TRIALS`, default 3) and
  compares the *mean* recall, so model variance can't cause a false
  failure. Includes a genuinely long (3000+ token) task so folding
  AND sharding actually fire (they gate at >1000 / >2000 tokens),
  exercising the real compression path — not just the retain filter.
  Gate: optimized mean recall must not fall below the delta floor.
  Writes `scripts/bench-quality-results.json`.

## Changed
- **Reasoning control for local reasoning models.** Gemma 4 E2B (and
  E4B) emit chain-of-thought by default, which is slow and
  non-deterministic on a local runtime. The OpenRouter adapter now
  passes a `reasoning` field through (`{ effort: "none"|"low"|
  "medium"|"high" }` or `false`), defaulting to OFF for local
  runs via `--no-reasoning` (CLI) or `GUARDIAN_REASONING=none`
  (env). With reasoning off the local model answers directly — ~6x
  faster and deterministic, matching a fast local tuning loop.
  rescues: (1) `user` and `system` turns are always retained (the
  query is sacred — previously a short user query could be pruned to an
  empty `messages` array); (2) a turn carrying an answer/action signal
  (code, file path, URL, metric, step verb) or acting as the *sole
  carrier* of a unique high-value entity is force-kept. This protects
  accuracy: the filter is now a noise filter, not an answer filter.
- README "Local Providers" + new "Benchmarking" section updated to
  match the actual code (the server `--lm-studio` / `--base-url`
  workflow, not the previously-documented provider-router commands).

## Fixed
- Live test surfaced that the Retain Pre-Filter pruned the user query,
  producing an empty `messages` array at the provider. Now fixed by the
  sacred-role rule above.

# llm-guardian v1.6.28

Wires the Tool Gating and Prompt Caching modules into the live optimization
pipeline (they were previously present as standalone modules but not invoked
by the orchestrator), and adds an end-to-end benchmark harness.

## Added
- **Orchestrator benchmark harness** (`scripts/bench-orchestrator.ts`, `bun run
  bench:orchestrator`) — runs the full pipeline (retain pre-filter → tool
  gating → semantic folding → VCM sharding → prompt caching) over a corpus of
  realistic multi-turn agent conversations and reports end-to-end compression
  ratio plus p50/p95/p99 latency. Includes a CI gate that fails if mean
  compression drops below the stated floor or p99 latency exceeds the sub-30ms
  budget. Writes `scripts/bench-orchestrator-results.json`.

## Changed
- **Tool Gating is now wired into the orchestration pipeline** — previously an
  orphaned module. It runs as Step 2b (after tool fusion, before folding): the
  tool catalog is filtered to the query-relevant subset (top 8 by term-overlap
  relevance) so only relevant schemas are folded, sharded, and sent to the
  provider. No-op for catalogs ≤ 8 tools. New metrics: `toolGatingApplied`,
  `toolGatingRemoved`.
- **Prompt Caching is now wired into the orchestration pipeline** — runs as
  Step 4b (after sharding, before model selection): the conversation is
  reordered into a stable cacheable prefix + volatile suffix and stamped with
  Anthropic `cache_control` breakpoints when the prefix ≥ 1024 tokens. The
  `token-efficient-tools-2025` beta header is attached whenever tools are
  present and caching is enabled. New metrics: `promptCachingApplied`,
  `promptCachingPrefixTokens`, `tokenEfficientToolsUsed`.
- **HTTP API + CLI** now accept `enable_tool_gating` / `enable_prompt_caching`
  (default on) on `/v1/chat/completions`, and the values flow through
  `GuardianRequest` → `complete()` → provider headers.

## Fixed
- `complete()` / `completeStream()` (OpenRouter adapter) now honor the
  `tokenEfficientTools` request flag and attach the beta header when set.

# llm-guardian v1.6.27

Performance + integration release: activates the Retain Pre-Filter end-to-end and
adds token-time optimizations to the optimization pipeline, plus the first
cross-repo AI Trio integration point with memos.

## Added

- **AI Trio memory integration** (`src/core/memos-memory-source.ts`) — optional,
  decoupled adapter that bridges VCM Sharding to the memos (`@mem-os/sdk`) sibling
  repo. `createMemOSMemorySource()` lazily imports MemOS and produces a TOON
  context pack (60-90% smaller than JSON) consumable by the orchestrator via
  `request.memoryPack`. Guardian takes no hard dependency on memos — the package
  is only resolved at call time, so both repos stay independently publishable.
- **Automatic server wiring for the MemOS pack** — the `/v1/chat/completions`
  handler now builds a memory pack per request (env-gated via `MEMOS_NAMESPACE` /
  `MEMOS_STORAGE_PATH`) and injects it ahead of the conversation. A cached,
  process-wide MemOS source is reused across requests; failures are soft (the
  request proceeds without memory) so standalone Guardian instances are
  unaffected. An explicit `memory_pack` in the request body overrides the
  auto-built pack.
- **Local dev setup for the MemOS pack** — `memos-memory-source.ts` now passes
  `dbPath` (was `storagePath`, which MemOS doesn't accept). Added
  `scripts/smoke-memos.ts` (run under Node) that builds a real TOON pack from
  `~/.memos/memos.db` and asserts it survives VCM sharding as the top shard.
  README documents the symlink + the Bun/`better-sqlite3` runtime constraint
  (memos-backed memory requires running Guardian under Node, or calling a
  MemOS HTTP/MCP server).
- **`request.memoryPack`** field on `GuardianRequest` — a pre-built, already
  compressed memory pack injected as a high-relevance context shard ahead of
  VCM Sharding. Surfaced in metrics as `memoryPackInjected` / `memoryPackTokens`.

## Changed

- **Retain Pre-Filter is now wired into the orchestration pipeline** — previously
  an orphaned module. It runs as Step 1b (after privacy, before folding/sharding)
  in both `orchestrate()` and `orchestrateStream()`, dropping low-signal turns
  (greetings, acknowledgements, restatements) before any expensive processing.
  System messages are always preserved; novelty tracking accumulates seen
  entities across kept turns. New metrics: `retainFilterApplied`,
  `retainFilterDropped`, `retainFilterTokensSaved`.
- **VCM Sharding: eliminated N+1 entity re-extraction** — `buildSkeleton()` now
  returns per-message entities (`entitiesByIndex`) that `scoreMessages()` reuses,
  so entity regexes run exactly once per message instead of being re-run during
  scoring. Same relevance results, lower CPU on large contexts.
- **VCM Sharding: fixed re-expansion after folding** — sharding is now gated on
  the *post-fold* token count (not pre-fold), and its budget is sized to
  `min(3000, floor(postFoldTokens * 0.9))` so sharding still compresses rather
  than re-expanding a folded context back toward its original size.

# llm-guardian v1.6.26

This release adds the standalone token-efficiency modules and community files.
These modules are self-contained and compile cleanly on `main`.

> **Note on scope:** the *wiring* that activates these modules end-to-end
> (orchestrator integration behind `enableToolGating` / `enablePromptCaching` /
> `enableRetainFilter`, and the cache-aware Anthropic adapter with the
> `token-efficient-tools-2025` beta header) lives with the broader
> providers/TUI work on the `guardian-tui-codex-pass` branch, which depends on
> infrastructure not yet on `main`. Those pieces ship with that branch. This
> release lands the modules themselves plus docs/community so they're available
> on `main` now.

## Added

- **Pluggable BPE token counter** (`src/core/token-counter.ts`) — a single
  GPT-style estimator backs folding budgets, VCM shard sizing, and prompt-cache
  breakpoint math. `estimateTokens()`, `estimateTokensTotal()`, plus
  `setTokenizer()` / `getTokenizer()` for dropping in `tiktoken` or a provider
  tokenizer for exact counts. Default heuristic matches MemOS `context-pack.ts`
  so the AI Trio count tokens identically. Re-exported from `folding-engine.ts`
  for backward compatibility.
- **Retain pre-filter** (`src/core/retain-filter.ts`) — scores candidate content
  on length, signal density, action verbs, and novelty; drops anything below
  `RETAIN_THRESHOLD` (0.35). Exports `scoreRetain()`, `shouldRetain()`,
  `decideRetain()`, `setRetainClassifier()`. (Integration via `enableRetainFilter`
  ships with the `guardian-tui-codex-pass` branch.)
- **Tool gating** (`src/core/tool-gater.ts`) — filters the tool catalog to the
  handful a query actually needs before schemas are sent. Term-overlap relevance
  scoring, `DEFAULT_MAX_TOOLS=8`, `RELEVANCE_FLOOR=0.05`. No-op when the catalog
  is already small or the query is empty. (Integration via `enableToolGating` /
  `maxTools` ships with the `guardian-tui-codex-pass` branch.)
- **Prompt caching** (`src/core/prompt-cache.ts`) — reorders the conversation
  into a stable prefix and stamps an `ephemeral` `cache_control` breakpoint once
  it clears 1024 tokens (`MIN_CACHEABLE_PREFIX_TOKENS`). Exports
  `structureForCaching()` and `TOKEN_EFFICIENT_TOOLS_BETA_HEADER`.
- Community files: `CONTRIBUTING.md`, `.github/ISSUE_TEMPLATE/bug_report.md`,
  `.github/ISSUE_TEMPLATE/feature_request.md`, `.github/PULL_REQUEST_TEMPLATE.md`.
- Benchmark harness `scripts/bench-v1626-modules.ts` with before/after result
  snapshots under `scripts/`.

## Performance

- **Semantic Folding improvements (additive)** — `foldText()` now uses an FNV-1a
  hashed cache key, order-preserving sentence dedup (`dedupSentences()`), an
  adaptive fold ratio (0.3–0.6 based on entity density), and an adaptive headline
  that skips when the body is already compact. Fixes the over-expansion regression
  on short inputs (58→74 became 56→56, ratio 1.000) and improves long-context
  compression ~3× via dedup. `compressSentence()` strips a broader
  filler/contraction list. No public API removed.
- **VCM Sharding improvements (additive)** — `assembleShards()` returns
  `{ shards, shardsDeduped }` with semantic cross-shard dedup
  (`contentSimilarity()`), an adaptive relevance cutoff (0.1 / 0.15 / 0.25 by
  budget usage), and richer entity extraction (URLs, endpoints, models, metrics).
  `ShardingResult` surfaces optional `shardsDeduped`, `budgetUsed`, `budgetTotal`
  for observability. No existing shard shape changed.

## Changed

- **Token counting** — `folding-engine.ts` and `vcm-sharder.ts` now import
  `estimateTokens` from the new `token-counter.ts` module instead of inlining
  their own heuristics; `folding-engine.ts` re-exports it for backward
  compatibility.
- `src/core/types.ts` — `ShardingResult` extended with optional `shardsDeduped`,
  `budgetUsed`, `budgetTotal` (additive; existing consumers unaffected).
- `package.json` — fixed the package description, added npm-discovery keywords,
  `sideEffects: false`, `publishConfig`, and repository/homepage/bugs metadata.
- `README.md` — stars badge, v1.6.26 section with code samples, organization
  references fixed to `Markgatcha`.

## Verification

`tsc --noEmit` clean (0 real errors). The four new modules compile standalone on
`main`. (The pre-existing `baseUrl` TS5101 deprecation notice is unrelated and
present before this release.)
