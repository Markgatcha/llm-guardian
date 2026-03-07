"""
llm-guardian — FastAPI application entry-point.

Run in development:
    uvicorn backend.main:app --reload

Run in production (via Docker):
    uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 4
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.proxy import router as proxy_router
from backend.api.v1 import router as v1_router
from backend.core.analytics import analytics_collector
from backend.core.auth import bootstrap_admin_api_keys
from backend.core.cache import lifespan_cache
from backend.core.router import lifespan_router
from backend.utils.db import SessionLocal, session_scope
from backend.utils.settings import settings

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def app_lifespan(app: FastAPI) -> AsyncIterator[None]:
    logger.info("guardian.startup")
    lifespan_cache.configure(
        redis_url=settings.redis_url,
        ttl=settings.cache_ttl_seconds,
        semantic_enabled=settings.semantic_cache_enabled,
        threshold=settings.semantic_cache_threshold,
        embedding_model=settings.embedding_model,
    )
    analytics_collector.configure(redis_url=settings.redis_url, session_factory=SessionLocal)
    await analytics_collector.connect()
    await lifespan_cache.connect()
    await lifespan_router.init()
    try:
        async with session_scope() as session:
            await bootstrap_admin_api_keys(session)
    except Exception:
        logger.warning("guardian.bootstrap_keys_failed")

    try:
        yield
    finally:
        logger.info("guardian.shutdown")
        await lifespan_cache.disconnect()
        await analytics_collector.disconnect()


def create_app() -> FastAPI:
    """Application factory — separates construction from execution for testing."""
    app = FastAPI(
        title="LLM Guardian",
        description="Self-hosted LLM API gateway",
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=app_lifespan,
    )

    # ── Middleware ─────────────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins or ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Routers ───────────────────────────────────────────────────────────
    app.include_router(proxy_router, prefix="/v1")
    app.include_router(v1_router, prefix="/api/v1")

    # ── Health endpoint ───────────────────────────────────────────────────
    @app.get("/health", tags=["ops"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()


def main() -> None:
    """Entry-point for the `guardian` CLI script defined in pyproject.toml."""
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level=logging.getLevelName(logging.INFO).lower(),
    )


if __name__ == "__main__":
    main()
