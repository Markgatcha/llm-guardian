# AGENTS.md

## Lint & Typecheck Commands

- **Lint**: `bunx biome check src/`
- **Typecheck**: `bunx tsc --noEmit`
- **Run all checks**: `bun run lint && bun run typecheck`

## Project Notes

- Runtime: Bun (not Node.js)
- TypeScript strict mode enabled
- Core engine files are in `src/core/`
- Dashboard is a separate React SPA in `src/dashboard/`
- The legacy Python backend is in `backend/` (reference only)
