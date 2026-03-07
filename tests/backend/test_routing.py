from __future__ import annotations

import pytest
from backend.core.analytics import analytics_collector
from backend.core.router import lifespan_router
from backend.models.rules import UserRule


@pytest.mark.asyncio
async def test_select_model_prefers_cheapest_candidate() -> None:
    await analytics_collector.update_latency("gpt-4o-mini", 80)
    await analytics_collector.update_latency("gpt-4.1-mini", 20)

    selected = await lifespan_router.select_model(
        {
            "model": "auto",
            "messages": [{"role": "user", "content": "hello"}],
            "max_tokens": 100,
            "stream": False,
            "rules": [],
        }
    )

    assert selected == "gpt-4o-mini"


@pytest.mark.asyncio
async def test_select_model_filters_by_capabilities() -> None:
    selected = await lifespan_router.select_model(
        {
            "model": "auto",
            "messages": [{"role": "user", "content": [{"type": "image_url", "image_url": {"url": "x"}}]}],
            "max_tokens": 9000,
            "stream": True,
            "rules": [],
        }
    )

    assert selected in {"gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"}


@pytest.mark.asyncio
async def test_select_model_applies_rules() -> None:
    rules = [
        UserRule(
            name="prefer-anthropic",
            rule_type="provider_pin",
            value={"provider": "anthropic"},
            priority=200,
            is_active=True,
        )
    ]

    selected = await lifespan_router.select_model(
        {
            "model": "auto",
            "messages": [{"role": "user", "content": "pick a model"}],
            "max_tokens": 200,
            "stream": False,
            "rules": rules,
        }
    )

    assert selected == "claude-3-haiku"
