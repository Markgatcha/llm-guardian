# Contributing to LLM Guardian

Thank you for helping make LLM Guardian better! This guide covers everything you need to get started.

---

## Table of Contents

- [Development setup](#development-setup)
- [Project structure](#project-structure)
- [Development workflows](#development-workflows)
- [Running tests](#running-tests)
- [Code style](#code-style)
- [Code of conduct](#code-of-conduct)
- [Submitting a pull request](#submitting-a-pull-request)

---

## Development Setup

### Prerequisites

- [Bun](https://bun.sh) 1.4.0 or newer (`engines.bun` enforces this)
- Git

### Quickest path (Docker)

```bash
git clone https://github.com/your-org/llm-guardian.git
cd llm-guardian
cp .env.example .env        # fill in at least one provider key + GUARDIAN_API_KEY
docker compose up --build   # API + dashboard on http://localhost:3000
```

### Local (no Docker)

```bash
git clone https://github.com/your-org/llm-guardian.git
cd llm-guardian
bun install --frozen-lockfile
cp .env.example .env        # fill in at least one provider key + GUARDIAN_API_KEY
bun run start               # server on http://localhost:3000
```

Useful commands:

```bash
bun run dev          # watch mode (auto-restart on change)
bun run dashboard    # serve the dashboard UI
bun run tui          # interactive terminal UI
bun run build        # compile to dist/guardian.js
```

---

## Project Structure

```
llm-guardian/
├── src/
│   ├── cli/                  # CLI entrypoint, TUI, server bootstrap (Hono)
│   ├── core/                 # Engine: folding, caching, token counting, tool fusion
│   ├── gateway/              # Proxy logic, privacy shield
│   ├── providers/            # Provider adapters + model registry
│   └── dashboard/            # React SPA served by the gateway
├── tests/
│   └── frontend/             # Vitest suites for the dashboard
├── scripts/                  # Benchmark harnesses (bun run bench:*)
├── docs/                     # This file and related docs
└── .github/workflows/        # CI (lockfile → typecheck/lint/test/build)
```

---

## Development Workflows

### Adding a new endpoint

1. Add the route in `src/cli/index.ts` (Hono app) or the relevant gateway module.
2. Add tests next to the code (`*.test.ts`, run by `bun test`).

### Adding a new setting

1. Read it from the environment in the relevant module (Guardian is configured via env vars — see `.env.example`).
2. Add the corresponding entry to `.env.example` with a comment.

---

## Running Tests

```bash
# Core test suites (parallel)
bun run test

# Everything, including CLI tests
bun run test:all

# Dashboard/frontend tests
bun run test:frontend

# Benchmarks
bun run bench:all
```

---

## Code Style

### TypeScript

- **Linter:** [Oxlint](https://oxc.rs/docs/guide/usage/linter.html) (OXC) — `bun run lint` (config: `.oxlintrc.json`)
- **Auto-fix:** `bun run lint:fix`
- **Type check:** `bun run typecheck`
- Component files use `.tsx`; pure logic uses `.ts`
- Tests live next to the code they cover (`foo.test.ts`)

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add semantic cache lookup
fix: correct daily budget reset logic
docs: update architecture endpoint table
chore: bump openai to 7.5.0
```

---

## Code of Conduct

By participating in this project, you agree to follow the repository
[Code of Conduct](../CODE_OF_CONDUCT.md).

Please keep discussions respectful, constructive, and focused on moving the project
forward. If you need to report a concern, do so through a private maintainer contact
channel rather than a public issue whenever possible.

---

## Submitting a Pull Request

1. **Fork** the repository and create a feature branch:
   ```bash
   git checkout -b feat/my-feature
   ```

2. **Make your changes.** Keep each PR focused on a single concern.

3. **Run the full check suite locally** before pushing:
   ```bash
   bun run lint && bun run typecheck && bun run test
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
- Environment details (OS, Bun version, Docker version)

---

## Questions?

Open a Discussion thread on GitHub. We're happy to help you get set up.
