---
name: Bug Report
about: Something in LLM-Guardian isn't working as expected
title: "[BUG] "
labels: ["bug", "needs-triage"]
assignees: ""
---

## Describe the Bug

A clear and concise description of what the bug is.

## Steps to Reproduce

1. Start Guardian with `bun run start` (or `guardian run "..."`)
2. Send a request with `...`
3. See error / unexpected behavior

## Expected Behavior

What you expected to happen.

## Actual Behavior

What actually happened. Include the full error message/stack trace if applicable.

```
Paste error output here
```

## Environment

- **LLM-Guardian version**: (e.g. `1.6.26`)
- **Runtime**: API server / CLI one-shot / TUI / dashboard
- **Bun version**: (`bun --version`)
- **Provider**: OpenRouter / Anthropic / Gemini / OpenAI-compatible / local
- **OS**: (e.g. Ubuntu 22.04, Windows 11, macOS 14)

## Optimization Metrics (if relevant)

For compression/cost/token issues, paste the `optimization` block from the response:

```json
{
  "foldingApplied": ...,
  "foldingCompressionRatio": ...,
  "shardingApplied": ...,
  "totalTokensSaved": ...,
  "totalSavingsUsd": ...
}
```

And the `bun run bench` output if reproducible.

## Minimal Reproducible Example

```typescript
// Paste the smallest snippet that reproduces the issue
```

## Additional Context

Any other context, screenshots, or logs that might help.
