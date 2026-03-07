"""
backend.api.v1 — Admin/dashboard API surface.
"""

from __future__ import annotations

from fastapi import APIRouter

from backend.api.v1 import chat, keys, logs, providers, rules, stats

router = APIRouter()

router.include_router(chat.router, prefix="/chat", tags=["chat"])
router.include_router(keys.router, prefix="/keys", tags=["keys"])
router.include_router(stats.router, prefix="/stats", tags=["stats"])
router.include_router(rules.router, prefix="/rules", tags=["rules"])
router.include_router(providers.router, prefix="/providers", tags=["providers"])
router.include_router(logs.router, prefix="/logs", tags=["logs"])
