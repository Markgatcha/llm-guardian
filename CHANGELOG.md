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
