"""
backend.core.analytics — Request telemetry persistence and reporting.
"""

from __future__ import annotations

import asyncio
import math
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import structlog
from redis.asyncio import Redis
from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.core.pricing import pricing_catalog
from backend.models.request_log import RequestLog
from backend.utils.settings import settings

logger = structlog.get_logger(__name__)


@dataclass(slots=True)
class RequestEvent:
    request_id: str
    model: str
    provider: str
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    baseline_cost_usd: float
    saved_usd: float
    latency_ms: float
    status: str
    error_code: str | None = None
    cache_hit: bool = False
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


class AnalyticsCollector:
    def __init__(
        self,
        redis_url: str | None = None,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
    ) -> None:
        self._url = redis_url or settings.redis_url
        self._session_factory = session_factory
        self._client: Any | None = None
        self._redis_available = False
        self._buffer: dict[str, RequestEvent] = {}
        self._background_tasks: set[asyncio.Task[None]] = set()
        self._memory_latency: dict[str, list[float]] = {}

    def configure(
        self,
        *,
        redis_url: str | None = None,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        client: Any | None = None,
    ) -> None:
        if redis_url is not None:
            self._url = redis_url
        if session_factory is not None:
            self._session_factory = session_factory
        if client is not None:
            self._client = client
            self._redis_available = True

    async def connect(self) -> None:
        if self._client is not None:
            try:
                await self._client.ping()
                self._redis_available = True
                return
            except Exception:
                self._client = None
                self._redis_available = False

        try:
            client = cast(Any, Redis.from_url(self._url, decode_responses=True))
            await client.ping()
            self._client = client
            self._redis_available = True
            logger.info("analytics.redis_connected", url=self._url)
        except Exception:
            self._client = None
            self._redis_available = False
            logger.warning("analytics.redis_unavailable", url=self._url)

    async def disconnect(self) -> None:
        if self._background_tasks:
            pending = tuple(self._background_tasks)
            self._background_tasks.clear()
            results = await asyncio.gather(*pending, return_exceptions=True)
            for result in results:
                if isinstance(result, Exception):
                    logger.warning("analytics.background_task_failed", error=str(result))
        if self._client is not None:
            await self._client.aclose()
        self._client = None
        self._redis_available = False

    def _request_log_from_event(self, event: RequestEvent) -> RequestLog:
        return RequestLog(
            id=event.request_id,
            model=event.model,
            provider=event.provider or pricing_catalog.get_provider(event.model),
            prompt_tokens=event.prompt_tokens,
            completion_tokens=event.completion_tokens,
            cost_usd=event.cost_usd,
            baseline_cost_usd=event.baseline_cost_usd,
            saved_usd=event.saved_usd,
            latency_ms=event.latency_ms,
            cache_hit=event.cache_hit,
            status=event.status,
            error_code=event.error_code,
            created_at=event.timestamp,
            updated_at=event.timestamp,
        )

    async def persist_event(self, event: RequestEvent) -> None:
        if self._session_factory is None:
            return
        async with self._session_factory() as session:
            try:
                if await session.get(RequestLog, event.request_id) is None:
                    session.add(self._request_log_from_event(event))
                    await session.commit()
            except IntegrityError:
                await session.rollback()
            except Exception:
                await session.rollback()
                logger.warning("analytics.persist_failed", request_id=event.request_id)
            finally:
                self._buffer.pop(event.request_id, None)

    def record(self, event: RequestEvent) -> None:
        self._buffer[event.request_id] = event
        if self._session_factory is not None:
            task = asyncio.create_task(self.persist_event(event))
            self._background_tasks.add(task)
            task.add_done_callback(self._background_tasks.discard)

    async def flush_to_db(self, session: AsyncSession) -> None:
        pending = list(self._buffer.values())
        self._buffer.clear()
        for event in pending:
            try:
                if await session.get(RequestLog, event.request_id) is None:
                    session.add(self._request_log_from_event(event))
                    await session.commit()
            except IntegrityError:
                await session.rollback()

    async def get_summary(self, session: AsyncSession) -> dict[str, Any]:
        row = (
            await session.execute(
                select(
                    func.count(RequestLog.id),
                    func.coalesce(func.sum(RequestLog.cost_usd), 0.0),
                    func.coalesce(func.sum(RequestLog.saved_usd), 0.0),
                    func.coalesce(func.sum(RequestLog.baseline_cost_usd), 0.0),
                    func.coalesce(func.avg(RequestLog.latency_ms), 0.0),
                    func.coalesce(func.sum(case((RequestLog.cache_hit.is_(True), 1), else_=0)), 0),
                )
            )
        ).one()

        total_requests = int(row[0] or 0)
        cache_hits = int(row[5] or 0)
        return {
            "total_requests": total_requests,
            "total_cost_usd": round(float(row[1] or 0.0), 8),
            "total_saved_usd": round(float(row[2] or 0.0), 8),
            "baseline_cost_usd": round(float(row[3] or 0.0), 8),
            "avg_latency_ms": round(float(row[4] or 0.0), 2),
            "cache_hit_rate": round(cache_hits / total_requests, 4) if total_requests else 0.0,
        }

    async def get_model_breakdown(self, session: AsyncSession) -> list[dict[str, Any]]:
        rows = await session.execute(
            select(
                RequestLog.model,
                RequestLog.provider,
                func.count(RequestLog.id),
                func.coalesce(func.sum(RequestLog.cost_usd), 0.0),
                func.coalesce(func.sum(RequestLog.saved_usd), 0.0),
                func.coalesce(func.avg(RequestLog.latency_ms), 0.0),
            )
            .group_by(RequestLog.model, RequestLog.provider)
            .order_by(func.sum(RequestLog.cost_usd).desc())
        )
        return [
            {
                "model": model,
                "provider": provider,
                "requests": int(requests or 0),
                "cost_usd": round(float(cost or 0.0), 8),
                "saved_usd": round(float(saved or 0.0), 8),
                "avg_latency_ms": round(float(latency or 0.0), 2),
            }
            for model, provider, requests, cost, saved, latency in rows.all()
        ]

    async def get_provider_breakdown(self, session: AsyncSession) -> list[dict[str, Any]]:
        rows = await session.execute(
            select(
                RequestLog.provider,
                func.count(RequestLog.id),
                func.coalesce(func.sum(RequestLog.cost_usd), 0.0),
                func.coalesce(func.sum(RequestLog.saved_usd), 0.0),
                func.coalesce(func.avg(RequestLog.latency_ms), 0.0),
            )
            .group_by(RequestLog.provider)
            .order_by(func.sum(RequestLog.cost_usd).desc())
        )
        return [
            {
                "provider": provider,
                "requests": int(requests or 0),
                "cost_usd": round(float(cost or 0.0), 8),
                "saved_usd": round(float(saved or 0.0), 8),
                "avg_latency_ms": round(float(latency or 0.0), 2),
            }
            for provider, requests, cost, saved, latency in rows.all()
        ]

    async def get_spend_summary(self, session: AsyncSession, days: int) -> dict[str, Any]:
        start_at = datetime.now(UTC) - timedelta(days=days)
        row = (
            await session.execute(
                select(
                    func.count(RequestLog.id),
                    func.coalesce(func.sum(RequestLog.cost_usd), 0.0),
                    func.coalesce(func.sum(RequestLog.baseline_cost_usd), 0.0),
                    func.coalesce(func.sum(RequestLog.saved_usd), 0.0),
                ).where(RequestLog.created_at >= start_at)
            )
        ).one()
        return {
            "days": days,
            "requests": int(row[0] or 0),
            "cost_usd": round(float(row[1] or 0.0), 8),
            "baseline_cost_usd": round(float(row[2] or 0.0), 8),
            "saved_usd": round(float(row[3] or 0.0), 8),
        }

    async def update_latency(self, model: str, latency_ms: float) -> None:
        key = f"guardian:latency:{model}"
        if self._redis_available and self._client is not None:
            try:
                await self._client.lpush(key, latency_ms)
                await self._client.ltrim(key, 0, settings.latency_window_size - 1)
                return
            except Exception:
                self._redis_available = False
                logger.warning("analytics.latency_redis_failed", model=model)

        history = self._memory_latency.setdefault(model, [])
        history.append(float(latency_ms))
        self._memory_latency[model] = history[-settings.latency_window_size :]

    async def get_p95_latency(self, model: str) -> float:
        values: list[float] = []
        key = f"guardian:latency:{model}"
        if self._redis_available and self._client is not None:
            try:
                raw_values = await self._client.lrange(key, 0, settings.latency_window_size - 1)
                values = [float(value) for value in raw_values]
            except Exception:
                self._redis_available = False
                logger.warning("analytics.latency_read_failed", model=model)

        if not values:
            values = list(self._memory_latency.get(model, []))
        if not values:
            return 0.0

        ordered = sorted(values)
        index = max(0, math.ceil(len(ordered) * 0.95) - 1)
        return round(float(ordered[index]), 2)


analytics_collector = AnalyticsCollector()
