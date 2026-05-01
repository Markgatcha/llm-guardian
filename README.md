# LLM-Guardian V1.0.0

[![npm version](https://img.shields.io/badge/npm-coming%20soon-lightgrey?logo=npm)](https://www.npmjs.com/package/llm-guardian)
[![CI](https://github.com/Markgatcha/llm-guardian/actions/workflows/ci.yml/badge.svg)](https://github.com/Markgatcha/llm-guardian/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Glama](https://img.shields.io/badge/Glama-coming%20soon-lightgrey)](https://glama.ai)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/runtime-Bun-black?logo=bun)](https://bun.sh)
**Central Nervous System of the AI Trio** — zero-config, sub-30ms token optimization with Semantic Folding & VCM Sharding.

> Part of the **AI Trio**: [Mem-OS](https://github.com/anomalyco/mem-os) (Memory) · [Universal-MCP-Toolkit](https://github.com/anomalyco/universal-mcp-toolkit) (Tools) · **LLM-Guardian** (Optimization)

---

## What It Does

LLM-Guardian sits between your application and LLM providers, compressing prompts by 80-95% while preserving semantic quality.

| Feature | Description |
|---|---|
| **Semantic Folding (EDH)** | Converts verbose text into entity-dense headlinese: `[ACTION:Refactor][TARGET:VCM]` |
| **VCM Sharding** | Builds context skeletons and injects only high-relevance knowledge shards |
| **Cross-Model Fingerprinting** | Re-orders prompt components per model's attention biases (Claude 4.6, Gemini 3.1, GPT-5.2) |
| **Tool Fusion** | Compresses multiple MCP tool-turns into a single semantic block |
| **Privacy Shield** | PII redaction + prompt injection blocking (sub-millisecond) |
| **Budget Enforcement** | Per-request, daily, and monthly cost limits |
| **Smart Routing** | Selects cheapest capable model via OpenRouter |

---

## Quick Start

```bash
# Clone & install
git clone https://github.com/anomalyco/llm-guardian.git
cd llm-guardian
bun install

# Configure
export OPENROUTER_API_KEY="sk-or-..."

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
  apiKey: "sk-or-...",
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
│                 Guardian Orchestrator                     │
│                                                          │
│  1. Privacy Shield    → PII redaction + injection block  │
│  2. Tool Fusion       → Multi-turn MCP output compression│
│  3. Semantic Folding  → EDH entity-dense distillation    │
│  4. VCM Sharding      → Context skeleton + relevance cut │
│  5. Budget Check      → Per-request / daily / monthly    │
│  6. Model Selection   → Cheapest capable via fingerprint │
│  7. OpenRouter Call   → Unified API adapter              │
│  8. Analytics         → Cost, latency, compression logs  │
└─────────────────────────────────────────────────────────┘
      │
      ▼
   Response + Optimization Metrics
```

---

## File Structure

```
src/
  core/
    orchestrator.ts      # The Brain — coordinates all subsystems
    folding-engine.ts    # EDH: text → entity-dense headlinese
    vcm-sharder.ts       # Context skeleton + relevance sharding
    tool-fuser.ts        # MCP tool output compression
    types.ts             # TypeScript interfaces
  gateway/
    privacy-shield.ts    # PII scrubbing + injection detection
    budget-manager.ts    # Cost enforcement (request/daily/monthly)
  providers/
    fingerprints.ts      # Model attention bias profiles (2026 models)
    openrouter-adapter.ts # Unified API connector
  cli/
    index.ts             # Commands: --start, --dash, --optimize
  examples/
    folding-magic.ts     # Demo: 1k words → ~50 tokens
    mcp-handshake.ts     # Demo: MCP tool fusion
  dashboard/             # React 19 analytics dashboard
    App.tsx
    pages/
      OverviewPage.tsx   # Cost, latency, savings overview
      CompressionPage.tsx # Real-time compression analytics
      SavingsPage.tsx    # USD saved vs raw input
      ProvidersPage.tsx  # Model catalog with pricing
      LogsPage.tsx       # Request logs with pagination
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
| **LLM-Guardian** | Token optimization & cost control | **V1.0.0** |

Together, the Trio provides a complete local AI stack: memory, tools, and cost-optimized inference.

---

## CLI Reference

```bash
guardian start              # Start the API server
guardian start -p 3001      # Custom port
guardian start -k sk-or-... # Pass API key
guardian dash               # Serve the dashboard
guardian optimize "text"    # Run folding on text
guardian optimize "text" -t 50  # Max 50 output tokens
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
| `OPENROUTER_API_KEY` | — | OpenRouter API key (required) |
| `GUARDIAN_PORT` | `3000` | Server port |
| `DAILY_BUDGET_USD` | `50` | Daily spend cap |
| `MONTHLY_BUDGET_USD` | `500` | Monthly spend cap |
| `MAX_REQUEST_COST_USD` | `1.0` | Per-request cost limit |

---

## License

MIT — see [LICENSE](LICENSE).
