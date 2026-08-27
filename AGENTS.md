# AGENTS.md

## Lint & Typecheck Commands

- **Lint**: `bun run lint` (Oxlint — `oxlint src --quiet`)
- **Lint fix**: `bun run lint:fix`
- **Typecheck**: `bunx tsc --noEmit`
- **Run all checks**: `bun run lint && bun run typecheck && bun run test`

## Project Notes

- Runtime: Bun 1.4+ (not Node.js)
- Linter: Oxlint (OXC) — config lives in `.oxlintrc.json`
- TypeScript strict mode enabled
- Core engine files are in `src/core/`
- Gateway/server logic in `src/gateway/` and `src/cli/`
- Dashboard is a React SPA in `src/dashboard/`
