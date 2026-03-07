"""
backend.api.v1.logs — Paginated request logs for the dashboard.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.auth import require_admin
from backend.models.request_log import RequestLog
from backend.utils.db import get_session

router = APIRouter(dependencies=[Depends(require_admin)])
SessionDep = Annotated[AsyncSession, Depends(get_session)]
LimitQuery = Annotated[int, Query(ge=1, le=200)]
OffsetQuery = Annotated[int, Query(ge=0)]


def _serialize_log(log: RequestLog) -> dict[str, Any]:
    return {
        "id": log.id,
        "model": log.model,
        "provider": log.provider,
        "prompt_tokens": log.prompt_tokens,
        "completion_tokens": log.completion_tokens,
        "cost_usd": log.cost_usd,
        "baseline_cost_usd": log.baseline_cost_usd,
        "saved_usd": log.saved_usd,
        "latency_ms": log.latency_ms,
        "status": log.status,
        "error_code": log.error_code,
        "cache_hit": log.cache_hit,
        "created_at": log.created_at.isoformat() if isinstance(log.created_at, datetime) else None,
    }


@router.get("")
async def list_logs(
    session: SessionDep,
    limit: LimitQuery = 50,
    offset: OffsetQuery = 0,
    status: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    filters = []
    if status:
        filters.append(RequestLog.status == status)
    if model:
        filters.append(RequestLog.model == model)

    query = select(RequestLog).order_by(RequestLog.created_at.desc()).offset(offset).limit(limit)
    count_query = select(func.count()).select_from(RequestLog)
    for clause in filters:
        query = query.where(clause)
        count_query = count_query.where(clause)

    logs = (await session.execute(query)).scalars().all()
    total = int(await session.scalar(count_query) or 0)
    return {"total": total, "limit": limit, "offset": offset, "items": [_serialize_log(log) for log in logs]}
