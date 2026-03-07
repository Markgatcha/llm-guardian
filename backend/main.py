"""
llm-guardian — FastAPI application entry-point.

Run in development:
    uvicorn backend.main:app --reload

Run in production (via Docker):
    uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 4
"""

from __future__ import annotations

import logging

import structlog
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.v1 import router as v1_router
from backend.core.cache import lifespan_cache
from backend.core.router import lifespan_router

logger = structlog.get_logger(__name__)


def create_app() -> FastAPI:
    """Application factory — separates construction from execution for testing."""
    app = FastAPI(
        title="LLM Guardian",
        description="Self-hosted LLM API gateway",
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
    )

    # ── Middleware ─────────────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],   # TODO: restrict via settings.ALLOWED_ORIGINS
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Routers ───────────────────────────────────────────────────────────
    app.include_router(v1_router, prefix="/api/v1")

    # ── Lifecycle hooks ───────────────────────────────────────────────────
    @app.on_event("startup")
    async def startup() -> None:
        logger.info("guardian.startup")
        await lifespan_cache.connect()
        await lifespan_router.init()

    @app.on_event("shutdown")
    async def shutdown() -> None:
        logger.info("guardian.shutdown")
        await lifespan_cache.disconnect()

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
