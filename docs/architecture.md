# LLM Guardian — Architecture

## Overview

LLM Guardian is a self-hosted FastAPI application that acts as an OpenAI-compatible API gateway. All LLM traffic flows through it so the platform can enforce guardrails, serve cached responses, route to the cheapest/fastest model, track costs, and surface analytics to an admin dashboard.

---

## System Diagram

```
Browser / API client
        │
        │  POST /v1/chat/completions   (OpenAI-compatible — any OpenAI SDK)
        │  POST /v1/completions        (legacy text completion)
        ▼
┌──────────────────────────────────────────────────────────┐
│                    FastAPI Gateway                        │
│  Middleware: CORS                                         │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Guardrails Engine                   │   │
│  │  • PII regex (email, phone, SSN)                 │   │
│  │  • Prompt-injection pattern matching             │   │
│  │  • Max prompt tokens (default 4 096)             │   │
│  │  • Per-request cost cap (default $1.00)          │   │
│  │  • Daily budget (default $10) → HTTP 402         │   │
│  │  • Monthly budget (default $100) → HTTP 402      │   │
│  │  • Expensive model confirmation → HTTP 409       │   │
│  └───────────────────────┬──────────────────────────┘   │
│                          │ pass                          │
│  ┌───────────────────────▼──────────────────────────┐   │
│  │          Response Cache  (Redis Stack)            │   │
│  │  • Exact-match: SHA-256(model + messages) → TTL  │   │
│  │  • Semantic cache: embeddings + cosine similarity│   │
│  │  • Cache hit → return immediately, $0 LLM cost   │   │
│  └─────────┬─────────────────────────────┬──────────┘   │
│         miss│                         hit │              │
│  ┌──────────▼──────────────────────┐  ◄──┘              │
│  │         LLM Router (LiteLLM)    │                    │
│  │  Candidates filtered by:        │                    │
│  │  • streaming support            │                    │
│  │  • vision support               │                    │
│  │  • context window fit           │                    │
│  │  • output token limit           │                    │
│  │  Selected by: min cost,         │                    │
│  │  then p95 latency tie-break     │                    │
│  │  Fallback chain: openai → groq  │                    │
│  │  anthropic → azure → vertex →   │                    │
│  │  ollama                         │                    │
│  └──────────┬──────────────────────┘                    │
│             │ LLM response                               │
│  ┌──────────▼──────────────────────────────────────┐   │
│  │          Pricing & Analytics                     │   │
│  │  • Token → USD cost (per-model catalog)          │   │
│  │  • Savings vs. baseline model (default gpt-4o)   │   │
│  │  • Async write to RequestLog (SQLAlchemy)        │   │
│  │  • Response stored in cache                      │   │
│  └──────────┬──────────────────────────────────────┘   │
└─────────────┼────────────────────────────────────────────┘
              │
   ┌──────────▼──────────────────────┐
   │  SQLite (dev) / PostgreSQL (prod)│
   │  Tables: request_log, api_key,   │
   │          user_rule               │
   │  Migrations: Alembic (2 revs)    │
   └──────────────────────────────────┘

Admin browser
   │
   │  GET/POST /api/v1/{stats,keys,rules,logs,providers}
   │  Auth: X-Guardian-Key header (PBKDF2-hashed admin key)
   ▼
┌──────────────────────────────────────────────────────────┐
│                React 19 + Vite SPA                        │
│  Pages: Overview · Providers · Rules · Keys · Logs        │
│  Charts: Recharts (area spend · bar model breakdown)      │
└──────────────────────────────────────────────────────────┘
```

---

## API Endpoints

### OpenAI-Compatible Proxy  (`/v1`)

These endpoints accept the same request/response schema as OpenAI's API. Any OpenAI SDK or tool works by changing `base_url`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/chat/completions` | Chat completion (streaming supported) |
| `POST` | `/v1/completions` | Legacy text completion |

**Request headers (optional)**

| Header | Effect |
|---|---|
| `X-Guardian-Preview-Only: 1` | Return cost estimate only — no LLM call made (HTTP 200) |
| `X-Guardian-Confirm-Expensive: 1` | Confirm a request above the expensive-model threshold |

**Response headers added by Guardian**

| Header | Value |
|---|---|
| `X-Guardian-Model` | Model actually routed to |
| `X-Guardian-Estimated-Cost-Usd` | Pre-call cost estimate |
| `X-Guardian-Actual-Cost-Usd` | Post-call actual cost |
| `X-Guardian-Cache` | `hit` or `miss` |

**Error status codes**

| Code | Meaning |
|---|---|
| `402` | Daily or monthly budget exceeded |
| `409` | Request exceeds expensive-model threshold; resend with confirmation header |
| `422` | Guardrail blocked (PII / injection / token limit) |

### Admin / Dashboard API  (`/api/v1`)

All endpoints require the `X-Guardian-Key` header (or `Authorization: Bearer <key>`).

#### Stats  (`/api/v1/stats`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/stats/summary` | Totals: requests, cost, avg latency, cache-hit rate, savings |
| `GET` | `/api/v1/stats/models` | Per-model breakdown |
| `GET` | `/api/v1/stats/providers` | Per-provider breakdown |
| `GET` | `/api/v1/stats/costs` | Cost split: today / 7 d / 30 d |
| `GET` | `/api/v1/stats/savings` | Savings vs. baseline: 7 d / 30 d |

#### Keys  (`/api/v1/keys`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/keys` | List admin keys |
| `POST` | `/api/v1/keys` | Create key (returns plain-text `key` once) |
| `GET` | `/api/v1/keys/{id}` | Get key metadata |
| `PATCH` | `/api/v1/keys/{id}` | Update name or active status |
| `DELETE` | `/api/v1/keys/{id}` | Delete key |

#### Rules  (`/api/v1/rules`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/rules` | List routing rules |
| `POST` | `/api/v1/rules` | Create rule |
| `GET` | `/api/v1/rules/{id}` | Get rule |
| `PATCH` | `/api/v1/rules/{id}` | Update rule |
| `DELETE` | `/api/v1/rules/{id}` | Delete rule |

#### Logs  (`/api/v1/logs`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/logs` | Paginated request log (`limit`, `offset`, `status`, `model`) |

#### Providers  (`/api/v1/providers`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/providers` | Full provider catalog with models and pricing |
| `GET` | `/api/v1/providers/{name}` | Single provider detail |

#### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check — returns `{"status": "ok"}` |

---

## Key Modules

| Module | Path | Responsibility |
|---|---|---|
| Proxy router | `backend/api/proxy.py` | OpenAI-compatible `/v1` route handlers |
| Admin API | `backend/api/v1/` | Dashboard CRUD routes (`stats`, `keys`, `rules`, `logs`, `providers`) |
| LLM Router | `backend/core/router.py` | LiteLLM provider selection, filtering, fallback chain |
| Cache | `backend/core/cache.py` | Redis exact-match cache (TTL, SHA-256 key) |
| Guardrails | `backend/core/guardrails.py` | PII, injection, token-budget, cost-budget enforcement |
| Pricing | `backend/core/pricing.py` | Per-model token → USD calculation, savings vs. baseline |
| Analytics | `backend/core/analytics.py` | Async event collection, DB persistence, aggregated metrics |
| Auth | `backend/core/auth.py` | Admin key hashing (PBKDF2-SHA256), bootstrap from env |
| Rules engine | `backend/core/rules.py` | Applies user-defined routing rules |
| Settings | `backend/utils/settings.py` | Pydantic-Settings loader (env / `.env` file) |
| DB session | `backend/utils/db.py` | Async SQLAlchemy session factory |

---

## Data Flow (detailed)

1. Client sends `POST /v1/chat/completions` with an OpenAI-compatible body.
2. **Guardrails** inspect the prompt: PII, injection patterns, token count, cumulative spend.  
   - Block → return `422` (guardrail) or `402` (budget) or `409` (confirm-expensive).
3. **Cache** computes `SHA-256(model + messages)` and checks Redis.  
   - Hit → return cached response with `X-Guardian-Cache: hit`. No LLM cost.
4. **Router** builds a candidate list from the provider catalog, filtered by capability (streaming, vision, context window). Selects minimum-cost model; p95 latency as tie-breaker.
5. LiteLLM dispatches to the selected provider. On failure, tries the fallback chain.
6. Response is written to the Redis cache (with TTL) and a `RequestLog` row is persisted asynchronously.
7. Response is returned to the client with Guardian response headers appended.

---

## Database Schema

### `request_log`
Persists every proxied request for analytics and audit.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `model` | text | Routed model name |
| `provider` | text | Provider (openai, anthropic, …) |
| `prompt_tokens` | int | Input tokens used |
| `completion_tokens` | int | Output tokens generated |
| `cost_usd` | float | Actual cost |
| `baseline_cost_usd` | float | Cost using baseline model (default gpt-4o) |
| `saved_usd` | float | `baseline - actual` |
| `latency_ms` | int | Wall-clock request duration |
| `status` | text | `success` / `error` |
| `error_code` | text? | Guardian or provider error code |
| `cache_hit` | bool | Whether response was served from cache |
| `created_at` | datetime | Event timestamp |

### `api_key`
Admin keys with PBKDF2 hashes.

### `user_rule`
Operator-defined routing rules (priority-ordered, typed JSON value).

---

## Roadmap

- [ ] Redis-native semantic index for larger cache catalogs
- [ ] Per-API-key rate limiting (Redis sliding window)
- [ ] Live request/event streaming to the dashboard
- [ ] Multi-tenant key management with per-key budgets
- [ ] Presidio integration for production-grade PII detection
- [ ] Real-time dashboard via Redis Streams + SSE fan-out
- [ ] Prometheus `/metrics` endpoint + Grafana dashboard template
- [ ] OpenTelemetry tracing
