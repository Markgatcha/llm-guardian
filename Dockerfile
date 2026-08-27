# syntax=docker/dockerfile:1
FROM oven/bun:1.4 AS base

WORKDIR /app

# ── Dependencies ─────────────────────────────────────────────────────────────
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ── Application source ───────────────────────────────────────────────────────
COPY . .
RUN bun run build

EXPOSE 3000

CMD ["bun", "run", "start"]
