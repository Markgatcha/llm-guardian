## Summary

Brief description of what this PR does.

Fixes #(issue number)

## Type of Change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New optimization pass / feature (non-breaking, gated behind an `enable*` flag)
- [ ] New provider adapter
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation update
- [ ] CI/build improvements

## Changes Made

-
-
-

## Testing

All PRs must pass:

```bash
bun run typecheck
bun run lint
bun test tests/tui tests/cli
```

If you touched the optimization engines (`folding-engine.ts`, `vcm-sharder.ts`, `tool-fuser.ts`, `token-counter.ts`, `retain-filter.ts`, `tool-gater.ts`, `prompt-cache.ts`), also run:

```bash
bun run bench
```

- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes
- [ ] `bun test tests/tui tests/cli` passes (190 tests)
- [ ] `bun run bench` shows no latency regression (folding stays sub-30ms)
- [ ] I've added tests for new functionality

## Optimization Impact (if applicable)

If this changes compression or token savings, report the before/after bench numbers:

| Metric | Before | After |
|---|---|---|
| folding compressionRatio |  |  |
| tokens saved |  |  |
| p95 latency |  |  |

## Checklist

- [ ] My code follows the project's style guidelines (TypeScript strict, no `any` without justification)
- [ ] New optimization passes are gated behind `enable*` flags and default off (additive, no behavior change for existing callers)
- [ ] Token counting uses `estimateTokens` from `token-counter.ts` (no re-implemented heuristic)
- [ ] I've updated the relevant documentation (README, docs/, CHANGELOG)
- [ ] Changes to `ai-trio` contracts are coordinated with MemOS + UMT
- [ ] I've reviewed my own diff before requesting a review
