"""
backend.api.v1 — Version-1 API router.

All feature sub-routers are registered here and included in main.py under
the ``/api/v1`` prefix.
"""

from __future__ import annotations

from fastapi import APIRouter

from backend.api.v1 import chat, keys, stats

router = APIRouter()

router.include_router(chat.router, prefix="/chat", tags=["chat"])
router.include_router(keys.router, prefix="/keys", tags=["keys"])
router.include_router(stats.router, prefix="/stats", tags=["stats"])
