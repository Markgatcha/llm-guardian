# LLM Guardian — Architecture Overview

> **Status:** scaffold phase — this document will be expanded as the implementation progresses.

## System Diagram

```
Client (browser / API consumer)
        │
        ▼
┌───────────────────────────────────────┐
│           FastAPI Gateway             │
│  ┌───────────────────────────────┐   │
│  │  POST /api/v1/chat/completions│   │
│  └──────────────┬────────────────┘   │
│                 │                     │
│   ┌─────────────▼──────────────┐     │
│   │      Guardrails Engine     │     │
│   │  PII · injection · budget  │     │
│   └─────────────┬──────────────┘     │
│                 │                     │
│   ┌─────────────▼──────────────┐     │
│   │       Response Cache       │     │
│   │   Redis Stack  (exact +    │     │
│   │   semantic VSS — future)   │     │
│   └──────┬──────────┬──────────┘     │
│       miss│       hit│               │
│   ┌───────▼───┐  ◄───┘               │
│   │ LLM Router│  (LiteLLM)           │
│   │  openai   │                      │
│   │ anthropic │  fallback chain      │
│   └───────┬───┘                      │
│           │                          │
│   ┌───────▼──────────┐               │
│   │ Pricing / Analytics│             │
│   │  cost record +    │              │
│   │  analytics event  │              │
│   └───────┬──────────┘               │
└───────────┼───────────────────────────┘
            │
    ┌───────▼────────┐
    │  SQLite / PG   │  (SQLAlchemy + Alembic)
    └────────────────┘
```

## Key Components

| Module | Path | Responsibility |
|---|---|---|
| Router | `backend/core/router.py` | LiteLLM provider selection & fallback |
| Cache | `backend/core/cache.py` | Redis exact-match (+ future semantic) |
| Guardrails | `backend/core/guardrails.py` | PII, injection, token-budget checks |
| Pricing | `backend/core/pricing.py` | Token → USD cost calculation |
| Analytics | `backend/core/analytics.py` | Per-request event recording |
| Settings | `backend/utils/settings.py` | Pydantic-Settings config loading |
| DB session | `backend/utils/db.py` | Async SQLAlchemy session factory |

## Data Flow

1. Client sends `POST /api/v1/chat/completions`.
2. **Guardrails** check input; block if PII / injection / over-budget.
3. **Cache** is queried; hit → return immediately (no LLM cost).
4. **Router** forwards to the best available LLM provider via LiteLLM.
5. Response is stored in cache, cost is calculated, analytics event is recorded.
6. Response returned to client with augmented `cost_usd` and `cached` fields.

## Future Work

- [ ] Semantic cache using Redis Vector Similarity Search (VSS)
- [ ] Per-API-key rate limiting (Redis sliding window)
- [ ] Streaming (SSE) response forwarding
- [ ] Multi-tenant key management with budget allocation
- [ ] Presidio integration for production-grade PII detection
- [ ] Real-time dashboard via Redis Streams + SSE fan-out
- [ ] Prometheus metrics endpoint + Grafana dashboard

## Local Development

```bash
# Backend
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env    # fill in API keys
uvicorn backend.main:app --reload

# Frontend
cd frontend
npm install
npm run dev

# Full stack
docker compose up --build
```
