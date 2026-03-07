# llm-guardian

**LLM Guardian** is a self-hosted API gateway for large-language-model traffic.  
It provides routing, caching, guardrails, cost tracking, and a real-time analytics
dashboard — all in a single deployable stack.

> 🚧 **This project is in active development.**  
> The scaffold is in place; business logic is being built on top of it.

## Quick Start

```bash
# 1. Copy and fill in secrets
cp .env.example .env
cp config.example.yaml config.yaml

# 2. Start full stack
docker compose up --build

# 3. Backend only (dev)
cd backend
pip install -r ../requirements.txt
uvicorn main:app --reload
```

## Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, Uvicorn, LiteLLM |
| Cache | Redis Stack |
| Database | SQLite → PostgreSQL (via SQLAlchemy + Alembic) |
| Frontend | React 19, Vite, TypeScript, Tailwind CSS, Recharts |
| Testing | pytest + httpx · Vitest + React Testing Library |
| CI | GitHub Actions |

## Project Layout

```
llm-guardian/
├── backend/          FastAPI application
│   ├── core/         Router, cache, guardrails, pricing, analytics
│   ├── api/          Route handlers (versioned)
│   ├── models/       SQLAlchemy ORM models
│   ├── utils/        Shared helpers
│   └── alembic/      Database migrations
├── frontend/         React + Vite SPA
├── tests/            pytest + Vitest suites
├── docs/             Architecture & API reference
└── .github/          CI/CD workflows
```

## Contributing

See [docs/contributing.md](docs/contributing.md) once it is written.  
For now open an issue or a discussion thread.

## License

MIT — see [LICENSE](LICENSE).
