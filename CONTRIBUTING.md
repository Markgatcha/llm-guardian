# Contributing to LLM-Guardian

Thanks for your interest in improving LLM-Guardian — the token-optimization layer of the AI Trio. This guide covers setup, conventions, and how to submit changes.

## Quick Start

```bash
git clone https://github.com/Markgatcha/llm-guardian.git
cd llm-guardian
bun install

# Verify your environment
bun run typecheck
bun run lint
bun test tests/tui tests/cli
bun run bench
```

You'll need [Bun](https://bun.sh) ≥ 1.1.0 and TypeScript 6.0.

## Project Layout

```
src/
  core/         # Optimization engine (the heart of Guardian)
    orchestrator.ts        # Coordinates all subsystems per request
    folding-engine.ts      # Semantic Folding (EDH distillation)
    vcm-sharder.ts         # VCM Sharding (context skeleton + relevance cut)
    tool-fuser.ts          # MCP tool output compression
    token-counter.ts       # Pluggable token estimation (BPE approximation)
    retain-filter.ts       # Hermes-style retain pre-filter
    tool-gater.ts          # Lazy tool-schema loading
    prompt-cache.ts        # Prompt caching structure + Anthropic beta header
    types.ts               # Shared TypeScript interfaces
  gateway/      # Privacy shield, budget management
  providers/    # Provider adapters + routing (OpenRouter, Anthropic, Gemini, OpenAI-compatible)
  cli/          # `guardian` CLI
  tui/          # OpenTUI coding console
  dashboard/    # React analytics dashboard
```

## Before You Submit

Every PR must pass:

```bash
bun run typecheck   # tsc --noEmit
bun run lint        # biome check
bun test tests/tui tests/cli
```

If you touch the optimization engines (`folding-engine.ts`, `vcm-sharder.ts`, `tool-fuser.ts`, `token-counter.ts`), also run:

```bash
bun run bench       # regression check on compression ratios + latency
```

The folding target is **sub-30ms** local execution. If your change regresses the bench, note it in the PR description.

## Conventions

- **TypeScript strict mode**, no `any` without justification.
- **Sub-30ms budget**: optimization-engine code must stay fast and local (no LLM calls, no I/O) unless behind an explicit opt-in flag.
- **Additive features**: new optimization passes are gated behind `enable*` flags on `GuardianRequest` and default off — never change default behavior for existing callers.
- **Token counting**: use `estimateTokens` from `token-counter.ts`, never re-implement a heuristic.
- Commit messages: imperative mood (`Add semantic dedup to VCM sharder`).

## Reporting Issues

Use the issue templates (bug report, feature request). For token-savings or compression-regression reports, include:

- Input prompt size (tokens) and the `compressionRatio` from the response `optimization` metrics.
- Whether folding/sharding/tool-fusion/gating were enabled.
- The `bun run bench` output if reproducible.

## The AI Trio

LLM-Guardian is the optimization layer of the AI Trio:

| Component | Role |
|---|---|
| [Mem-OS](https://github.com/Markgatcha/memos) | Persistent memory layer |
| [Universal-MCP-Toolkit](https://github.com/Markgatcha/universal-mcp-toolkit) | Tool orchestration (MCP) |
| **LLM-Guardian** | Token optimization & cost control |

Changes to the shared `ai-trio` contracts (see `docs/ai-trio-contracts.md`) should be coordinated across all three repos.

## License

By contributing, you agree your contributions are licensed under the MIT License.
