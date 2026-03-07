# 🛡️ LLM Guardian

<p align="center">
  <strong>Self-hosted LLM API gateway with smart routing, response caching, guardrails, cost tracking, and a real-time analytics dashboard.</strong>
</p>

<p align="center">
  <a href="https://github.com/your-org/llm-guardian/actions/workflows/ci.yml">
    <img alt="CI" src="https://img.shields.io/github/actions/workflow/status/your-org/llm-guardian/ci.yml?branch=main&label=CI&logo=github">
  </a>
  <a href="LICENSE">
    <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg">
  </a>
  <img alt="Python 3.12+" src="https://img.shields.io/badge/python-3.12%2B-blue?logo=python&logoColor=white">
  <img alt="Docker" src="https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white">
  <a href="https://github.com/your-org/llm-guardian/stargazers">
    <img alt="Stars" src="https://img.shields.io/github/stars/your-org/llm-guardian?style=social">
  </a>
</p>

---

Drop LLM Guardian in front of your applications and **swap `base_url`** — you get:

- 🔀 **Smart routing** across OpenAI, Groq, Anthropic, Azure OpenAI, Google Vertex, and local Ollama
- ⚡ **Response caching** (exact-match via Redis) that eliminates repeat LLM calls
- 🔒 **Guardrails** — PII detection, prompt-injection blocking, per-request and daily/monthly budget enforcement
- 💰 **Cost tracking** with per-model pricing, savings vs. baseline, and trend charts
- 📊 **Admin dashboard** — React SPA with logs, API-key management, routing rules, and provider catalog
- 🔑 **API key management** — create, rotate, and deactivate admin keys

> 🚧 **Active development.** Core gateway, streaming, semantic caching, and dashboard flows are functional; richer timeseries analytics and multi-tenancy are on the roadmap.

---

## 📸 Screenshots

| Overview dashboard | Request logs | Provider catalog |
|---|---|---|
| *(metrics, cost charts, cache-hit rate)* | *(filterable log viewer with cost per call)* | *(pricing table and p95 latency by model)* |

> Screenshots will be added once the UI stabilises. Run locally to see the live dashboard.

---

## ⚡ Quick Start

### One command (Docker Compose)

```bash
git clone https://github.com/your-org/llm-guardian.git
cd llm-guardian
cp .env.example .env          # fill in at least OPENAI_API_KEY + GUARDIAN_API_KEY
docker compose up --build
```

| Service | URL |
|---|---|
| Backend API + Swagger | http://localhost:8000/docs |
| Frontend dashboard | http://localhost:5173 |
| RedisInsight | http://localhost:8001 |

### GitHub Codespaces / devcontainer

Click **"Open in Codespaces"** (or use the **Dev Containers** VS Code extension):

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/your-org/llm-guardian)

The devcontainer starts the full stack automatically. Open `http://localhost:5173` once the ports forward.

---

## 🔌 OpenAI SDK — one-line integration

LLM Guardian exposes an **OpenAI-compatible `/v1` API**. Change only `base_url` and `api_key`:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8000/v1",   # point at Guardian
    api_key="your-guardian-api-key",       # GUARDIAN_API_KEY from .env
)

response = client.chat.completions.create(
    model="gpt-4o",          # Guardian selects the cheapest capable model
    messages=[{"role": "user", "content": "Summarise the quarterly report."}],
)
print(response.choices[0].message.content)
```

**Response headers added by Guardian:**

| Header | Meaning |
|---|---|
| `X-Guardian-Model` | Model actually used |
| `X-Guardian-Estimated-Cost-Usd` | Pre-call cost estimate |
| `X-Guardian-Actual-Cost-Usd` | Post-call actual cost |
| `X-Guardian-Cache` | `hit` or `miss` |

**Cost preview** (no LLM call made):

```python
client.chat.completions.create(
    ...,
    extra_headers={"X-Guardian-Preview-Only": "1"},
)
# Returns HTTP 200 with cost estimate, no tokens consumed
```

---

## 🏗️ Architecture

```
Browser / API client
        │
        ▼  POST /v1/chat/completions  (OpenAI-compatible proxy)
┌──────────────────────────────────────────────────────────┐
│                    FastAPI Gateway                        │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Guardrails Engine                   │   │
│  │   PII regex · prompt-injection · budget checks   │   │
│  └───────────────────────┬──────────────────────────┘   │
│                          │ pass                          │
│  ┌───────────────────────▼──────────────────────────┐   │
│  │              Response Cache (Redis)               │   │
│  │   exact-match SHA-256 · semantic embeddings       │   │
│  └─────────┬─────────────────────────────┬──────────┘   │
│         miss│                         hit │              │
│  ┌──────────▼──────────┐          ◄───────┘              │
│  │     LLM Router      │  (LiteLLM)                     │
│  │  openai · groq      │  cost-optimised selection      │
│  │  anthropic · azure  │  + configurable fallback chain │
│  │  vertex · ollama    │                                │
│  └──────────┬──────────┘                                │
│             │                                            │
│  ┌──────────▼──────────────────────────────────────┐   │
│  │          Pricing & Analytics                     │   │
│  │  token cost calc · event persistence · savings   │   │
│  └──────────┬──────────────────────────────────────┘   │
└─────────────┼────────────────────────────────────────────┘
              │
   ┌──────────▼──────────┐
   │   SQLite / PostgreSQL│  (SQLAlchemy + Alembic)
   └─────────────────────┘

Admin dashboard  ←→  GET/POST /api/v1/{stats,keys,rules,logs,providers}
```

### Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, Uvicorn, LiteLLM |
| Cache | Redis Stack (exact-match + semantic cache embeddings) |
| Database | SQLite (dev) → PostgreSQL (prod) via SQLAlchemy + Alembic |
| Frontend | React 19, Vite, TypeScript, Tailwind CSS, Recharts |
| Testing | pytest + httpx · Vitest + React Testing Library |
| CI | GitHub Actions |

---

## 🐳 Docker Setup

### Full stack (recommended for local dev)

```bash
cp .env.example .env    # edit API keys and GUARDIAN_API_KEY
docker compose up --build
```

The compose file starts:
- **`api`** — FastAPI backend on port 8000
- **`redis`** — Redis Stack on port 6379 (RedisInsight on 8001)
- **`frontend`** — Vite dev server on port 5173 (hot-reload, proxies `/api` to the backend)

### Backend-only (fastest iteration)

```bash
python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn backend.main:app --reload
```

### Frontend-only (separate terminal)

```bash
cd frontend
npm install
npm run dev
# Dashboard at http://localhost:5173
# Expects backend at http://localhost:8000 (change VITE_API_URL to override)
```

---

## ⚙️ Configuration

All settings are controlled via environment variables (`.env` file). See [`.env.example`](.env.example) for the full list with descriptions.

The [`config.example.yaml`](config.example.yaml) mirrors every variable as a YAML reference — useful for documentation, Helm values, or manual auditing.

### Minimum required

```env
OPENAI_API_KEY=sk-...          # at least one LLM provider key
GUARDIAN_API_KEY=change-me     # admin key for the dashboard
SECRET_KEY=change-me-32-chars  # signing secret (32+ chars)
```

### Key optional settings

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | SQLite (dev) | Use `postgresql+asyncpg://...` in production |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection string |
| `DAILY_BUDGET_USD` | `10.0` | Hard daily spend cap (returns 402 when exceeded) |
| `MONTHLY_BUDGET_USD` | `100.0` | Hard monthly spend cap |
| `CACHE_TTL_SECONDS` | `300` | Cached response lifetime |
| `SEMANTIC_CACHE_ENABLED` | `true` | Enable embedding-based cache lookup over recent prompts |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CORS origins (comma-separated) |
| `ADMIN_API_KEYS` | — | Comma-separated bootstrap admin keys |

See [docs/architecture.md](docs/architecture.md) for the full system design and API reference.

---

## 🧪 Running Tests

```bash
# Backend (Python)
pytest tests/backend -v

# Frontend (TypeScript)
cd frontend && npm test -- --run

# Both via CI locally
act -j backend-test   # requires 'act' CLI
```

---

## 📁 Project Layout

```
llm-guardian/
├── backend/
│   ├── api/
│   │   ├── proxy.py          # OpenAI-compatible /v1 endpoints
│   │   └── v1/               # Admin dashboard API (/api/v1/*)
│   ├── core/                 # Router, cache, guardrails, pricing, analytics
│   ├── models/               # SQLAlchemy ORM (RequestLog, APIKey, UserRule)
│   ├── utils/                # Settings, DB session factory
│   └── alembic/              # Database migrations
├── frontend/                 # React 19 + Vite SPA
├── tests/                    # pytest + Vitest suites
├── docs/                     # Architecture, API reference, contributing
├── .devcontainer/            # VS Code / Codespaces devcontainer
└── .github/workflows/        # CI/CD
```

---

## 🤝 Contributing

See [docs/contributing.md](docs/contributing.md) for guidelines on setting up a dev environment, writing tests, and submitting pull requests.
Please also review the project's [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

Short version:
1. Fork → feature branch → PR against `main`
2. Backend: `ruff check` + `mypy` + `pytest` must all pass
3. Frontend: `npm run lint` + `npm run type-check` + `npm test` must all pass
4. Keep PRs focused; one concern per PR

---

## 📄 License

MIT — see [LICENSE](LICENSE).

---

> Built with **GPT-5.4 xhigh** for the open-source credits program.
