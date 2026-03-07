# Contributing to LLM Guardian

Thank you for helping make LLM Guardian better! This guide covers everything you need to get started.

---

## Table of Contents

- [Development setup](#development-setup)
- [Project structure](#project-structure)
- [Backend development](#backend-development)
- [Frontend development](#frontend-development)
- [Running tests](#running-tests)
- [Code style](#code-style)
- [Submitting a pull request](#submitting-a-pull-request)

---

## Development Setup

### Prerequisites

- Python 3.12+
- Node.js 20+
- Docker + Docker Compose (optional but recommended)
- Git

### Quickest path (Docker)

```bash
git clone https://github.com/your-org/llm-guardian.git
cd llm-guardian
cp .env.example .env        # fill in at least OPENAI_API_KEY + GUARDIAN_API_KEY
docker compose up --build
```

### Local (no Docker)

**Backend:**

```bash
python -m venv .venv
# macOS/Linux:
source .venv/bin/activate
# Windows:
.venv\Scripts\activate

pip install -e ".[dev]"
cp .env.example .env        # fill in secrets
alembic upgrade head        # run migrations
uvicorn backend.main:app --reload
# API at http://localhost:8000 — Swagger UI at http://localhost:8000/docs
```

**Frontend (separate terminal):**

```bash
cd frontend
npm install
npm run dev
# Dashboard at http://localhost:5173
```

---

## Project Structure

```
llm-guardian/
├── backend/
│   ├── api/
│   │   ├── proxy.py          # /v1 OpenAI-compatible endpoints
│   │   └── v1/               # /api/v1 admin dashboard endpoints
│   ├── core/                 # Business logic: router, cache, guardrails, etc.
│   ├── models/               # SQLAlchemy ORM models
│   ├── utils/                # Settings, DB session factory
│   └── alembic/              # Database migrations
├── frontend/                 # React 19 + Vite SPA
├── tests/
│   ├── backend/              # pytest suites
│   └── frontend/             # Vitest suites (in frontend/src/test/)
├── docs/                     # Architecture, API reference, this file
└── .github/workflows/        # CI (lint → test → Docker build)
```

---

## Backend Development

### Adding a new endpoint

1. Add a route handler in `backend/api/v1/` (or `backend/api/proxy.py` for `/v1`).
2. Register the router in `backend/api/v1/__init__.py` (or `backend/main.py`).
3. Add integration tests in `tests/backend/`.

### Adding a new setting

1. Add the field to `backend/utils/settings.py` (`Settings` class).
2. Add the corresponding entry to `.env.example` with a comment.
3. Mirror it in `config.example.yaml` under the appropriate section.

### Database migrations

```bash
# Generate a new migration after changing ORM models
alembic revision --autogenerate -m "describe your change"

# Apply migrations
alembic upgrade head

# Downgrade one step
alembic downgrade -1
```

---

## Frontend Development

The frontend is a React 19 + Vite SPA in the `frontend/` directory.

- **API client:** `frontend/src/lib/api.ts` — all API calls go through this module.
- **Types:** `frontend/src/lib/types.ts` — shared TypeScript types.
- **Hooks:** `frontend/src/hooks/` — data-fetching hooks built on `useApiQuery`.
- **Pages:** `frontend/src/pages/` — one file per route.

The Vite dev server proxies all `/api` requests to the backend (`VITE_API_URL`, default `http://localhost:8000`).

---

## Running Tests

### Backend

```bash
# All tests
pytest tests/backend -v

# Single file
pytest tests/backend/test_proxy.py -v

# With coverage
pytest tests/backend --cov=backend --cov-report=term-missing
```

Required environment for tests (`.env` or export):

```bash
DATABASE_URL=sqlite+aiosqlite:///./test.db
REDIS_URL=redis://localhost:6379/0
APP_ENV=testing
GUARDIAN_API_KEY=test-key
SECRET_KEY=test-secret-32-chars-xxxxxxxxxx
```

### Frontend

```bash
cd frontend

# Watch mode
npm test

# Single run (CI mode)
npm test -- --run

# With coverage
npm run test:coverage
```

---

## Code Style

### Python

- **Linter/formatter:** [Ruff](https://docs.astral.sh/ruff/) — `ruff check backend tests/backend`
- **Type checker:** [mypy](https://mypy.readthedocs.io/) — `mypy backend --ignore-missing-imports`
- Line length: 100 characters
- Target: Python 3.12+
- Use `from __future__ import annotations` in all modules

### TypeScript / React

- **Linter:** ESLint — `npm run lint` (zero warnings policy)
- **Type check:** `npm run type-check`
- Component files use `.tsx`; pure logic uses `.ts`

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add semantic cache lookup
fix: correct daily budget reset logic
docs: update architecture endpoint table
chore: bump litellm to 1.41.0
```

---

## Submitting a Pull Request

1. **Fork** the repository and create a feature branch:
   ```bash
   git checkout -b feat/my-feature
   ```

2. **Make your changes.** Keep each PR focused on a single concern.

3. **Run the full check suite locally** before pushing:
   ```bash
   ruff check backend tests/backend
   mypy backend --ignore-missing-imports
   pytest tests/backend -v
   cd frontend && npm run lint && npm run type-check && npm test -- --run
   ```

4. **Open a PR** against `main`. Fill out the PR template:
   - What does this change do?
   - How was it tested?
   - Any caveats or follow-up work?

5. CI will run automatically. All checks must pass before merge.

---

## Reporting Issues

Open a GitHub Issue with:
- A clear title
- Steps to reproduce (for bugs)
- Expected vs. actual behaviour
- Environment details (OS, Python version, Docker version)

---

## Questions?

Open a Discussion thread on GitHub. We're happy to help you get set up.
