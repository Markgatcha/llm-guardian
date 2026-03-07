"""
backend.api.v1.stats — Analytics and cost reporting endpoints.

TODO: replace in-memory summary with time-bucketed DB queries.
TODO: add /stats/models and /stats/keys breakdown endpoints.
"""

from __future__ import annotations

from fastapi import APIRouter

from backend.core.analytics import analytics_collector

router = APIRouter()


@router.get("/summary")
async def get_summary() -> dict:
    """Return a live in-memory request summary for the dashboard."""
    return analytics_collector.summary()


@router.get("/models")
async def get_model_breakdown() -> dict:
    """Return per-model usage breakdown (stub)."""
    # TODO: aggregate from RequestEvent buffer or DB
    return {"models": {}}


@router.get("/costs")
async def get_costs() -> dict:
    """Return cost totals for configurable time windows (stub)."""
    # TODO: query CostRecord rows from DB with date bucketing
    return {"today_usd": 0.0, "this_month_usd": 0.0}
