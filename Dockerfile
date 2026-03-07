# syntax=docker/dockerfile:1
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# ── System deps ───────────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl \
    && rm -rf /var/lib/apt/lists/*

# ── Python deps ───────────────────────────────────────────────────────────────
COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# ── Application source ────────────────────────────────────────────────────────
COPY backend/ ./backend/
COPY alembic.ini ./alembic.ini
COPY config.example.yaml ./config.example.yaml

# ── Non-root user ─────────────────────────────────────────────────────────────
RUN addgroup --system guardian && adduser --system --ingroup guardian guardian \
    && mkdir -p /data && chown guardian:guardian /data
USER guardian

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run Alembic migrations then start the server.
# Alembic uses DATABASE_URL from the environment (set in docker-compose or .env).
CMD ["sh", "-c", "alembic upgrade head && uvicorn backend.main:app --host 0.0.0.0 --port 8000"]
