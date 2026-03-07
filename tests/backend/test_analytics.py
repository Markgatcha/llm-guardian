from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from backend.core.analytics import AnalyticsCollector, RequestEvent
from backend.models.request_log import RequestLog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


@pytest.mark.asyncio
async def test_flush_to_db_persists_events(
    session_factory: async_sessionmaker[AsyncSession],
    fake_redis: Any,
) -> None:
    collector = AnalyticsCollector()
    collector.configure(client=fake_redis)
    collector.record(
        RequestEvent(
            request_id="req-1",
            model="gpt-4o-mini",
            provider="openai",
            prompt_tokens=10,
            completion_tokens=20,
            cost_usd=0.01,
            baseline_cost_usd=0.02,
            saved_usd=0.01,
            latency_ms=42.0,
            status="ok",
            timestamp=datetime.now(UTC),
        )
    )

    async with session_factory() as session:
        await collector.flush_to_db(session)
        logs = (await session.execute(select(RequestLog))).scalars().all()

    assert len(logs) == 1
    assert logs[0].provider == "openai"
    assert logs[0].saved_usd == 0.01


@pytest.mark.asyncio
async def test_summary_and_breakdowns(
    session_factory: async_sessionmaker[AsyncSession],
    fake_redis: Any,
) -> None:
    collector = AnalyticsCollector()
    collector.configure(client=fake_redis)
    collector.record(
        RequestEvent(
            request_id="req-2",
            model="gpt-4o-mini",
            provider="openai",
            prompt_tokens=10,
            completion_tokens=20,
            cost_usd=0.01,
            baseline_cost_usd=0.02,
            saved_usd=0.01,
            latency_ms=50.0,
            status="ok",
        )
    )
    collector.record(
        RequestEvent(
            request_id="req-3",
            model="claude-3-haiku",
            provider="anthropic",
            prompt_tokens=5,
            completion_tokens=5,
            cost_usd=0.005,
            baseline_cost_usd=0.015,
            saved_usd=0.01,
            latency_ms=70.0,
            status="cached",
            cache_hit=True,
        )
    )

    async with session_factory() as session:
        await collector.flush_to_db(session)
        summary = await collector.get_summary(session)
        models = await collector.get_model_breakdown(session)
        providers = await collector.get_provider_breakdown(session)
        spend = await collector.get_spend_summary(session, 30)

    assert summary["total_requests"] == 2
    assert summary["total_saved_usd"] == 0.02
    assert any(item["model"] == "gpt-4o-mini" for item in models)
    assert any(item["provider"] == "anthropic" for item in providers)
    assert spend["requests"] == 2


@pytest.mark.asyncio
async def test_latency_tracking(fake_redis: Any) -> None:
    collector = AnalyticsCollector()
    collector.configure(client=fake_redis)
    for latency in (10, 20, 30, 40, 50):
        await collector.update_latency("gpt-4o-mini", latency)

    assert await collector.get_p95_latency("gpt-4o-mini") == 50.0
