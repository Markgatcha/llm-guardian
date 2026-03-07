"""
backend.api.v1.stats — Analytics and cost reporting endpoints.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.analytics import analytics_collector
from backend.core.auth import require_admin
from backend.utils.db import get_session

router = APIRouter(dependencies=[Depends(require_admin)])
SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get("/summary")
async def get_summary(session: SessionDep) -> dict[str, Any]:
    summary = await analytics_collector.get_summary(session)
    summary["today"] = await analytics_collector.get_spend_summary(session, 1)
    summary["last_30_days"] = await analytics_collector.get_spend_summary(session, 30)
    return summary


@router.get("/models")
async def get_model_breakdown(session: SessionDep) -> dict[str, Any]:
    return {"models": await analytics_collector.get_model_breakdown(session)}


@router.get("/providers")
async def get_provider_breakdown(session: SessionDep) -> dict[str, Any]:
    return {"providers": await analytics_collector.get_provider_breakdown(session)}


@router.get("/costs")
async def get_costs(session: SessionDep) -> dict[str, Any]:
    return {
        "today": await analytics_collector.get_spend_summary(session, 1),
        "last_7_days": await analytics_collector.get_spend_summary(session, 7),
        "last_30_days": await analytics_collector.get_spend_summary(session, 30),
    }


@router.get("/savings")
async def get_savings(session: SessionDep) -> dict[str, Any]:
    last_7 = await analytics_collector.get_spend_summary(session, 7)
    last_30 = await analytics_collector.get_spend_summary(session, 30)
    return {
        "last_7_days": {
            "saved_usd": last_7["saved_usd"],
            "baseline_cost_usd": last_7["baseline_cost_usd"],
        },
        "last_30_days": {
            "saved_usd": last_30["saved_usd"],
            "baseline_cost_usd": last_30["baseline_cost_usd"],
        },
    }
