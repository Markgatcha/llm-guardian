---
name: Feature Request
about: Suggest a new optimization, provider adapter, or improvement for LLM-Guardian
title: "[FEATURE] "
labels: ["enhancement"]
assignees: ""
---

## Is your feature request related to a problem?

Describe the problem. e.g. "My agent's tool catalog is 50 tools and every call sends all schemas, burning tokens..."

## Describe the Solution You'd Like

A clear and concise description of what you want. Which optimization pass or subsystem does this touch?

- [ ] Semantic Folding (`folding-engine.ts`)
- [ ] VCM Sharding (`vcm-sharder.ts`)
- [ ] Tool Fusion (`tool-fuser.ts`)
- [ ] Tool Gating (`tool-gater.ts`)
- [ ] Prompt Caching (`prompt-cache.ts`)
- [ ] Retain Filter (`retain-filter.ts`)
- [ ] Token Counter (`token-counter.ts`)
- [ ] Provider adapter (`providers/`)
- [ ] Other

## Describe Alternatives You've Considered

Any alternative solutions or features you've considered.

## Expected Token / Cost Impact

If applicable, estimate the token savings or cost reduction this would enable (e.g. "cuts tool-schema overhead ~60%").

## Use Case

How would this be used in practice? What agent/provider setup benefits?

## Would You Be Willing to Contribute This?

- [ ] Yes, I'd like to implement this and submit a PR
- [ ] I can help with testing / benchmarks
- [ ] Documentation only
- [ ] No, requesting for others to implement

## Additional Context

Any other context, links to papers/tweets (e.g. Hermes-agent techniques), or examples from other projects.
