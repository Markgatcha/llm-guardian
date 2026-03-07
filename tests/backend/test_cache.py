from __future__ import annotations

from typing import Any

import pytest
from backend.core.cache import ResponseCache


@pytest.mark.asyncio
async def test_exact_match_cache_hit(fake_redis: Any) -> None:
    cache = ResponseCache(redis_url="redis://fake", embedding_func=None)
    cache.configure(client=fake_redis, semantic_enabled=False)
    await cache.connect()

    response = {"id": "1", "choices": [{"message": {"content": "hello"}}]}
    messages = [{"role": "user", "content": "same prompt"}]

    await cache.set("gpt-4o-mini", messages, response)
    cached = await cache.get("gpt-4o-mini", messages)

    assert cached == response


@pytest.mark.asyncio
async def test_semantic_cache_hit(fake_redis: Any) -> None:
    async def embedding_func(*, model: str, input: list[str], **kwargs: Any) -> dict[str, Any]:
        text = input[0].lower()
        if "weather" in text:
            return {"data": [{"embedding": [1.0, 0.0, 0.0]}]}
        return {"data": [{"embedding": [0.0, 1.0, 0.0]}]}

    cache = ResponseCache(redis_url="redis://fake", embedding_func=embedding_func, threshold=0.9)
    cache.configure(client=fake_redis)
    await cache.connect()

    await cache.set(
        "gpt-4o-mini",
        [{"role": "user", "content": "What is the weather today?"}],
        {"id": "2", "choices": [{"message": {"content": "Sunny"}}]},
    )

    cached = await cache.get(
        "gpt-4o-mini",
        [{"role": "user", "content": "weather forecast please"}],
    )

    assert cached is not None
    assert cached["choices"][0]["message"]["content"] == "Sunny"


@pytest.mark.asyncio
async def test_cache_falls_back_when_redis_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    class BrokenRedis:
        async def ping(self) -> None:
            raise RuntimeError("no redis")

    monkeypatch.setattr("backend.core.cache.Redis.from_url", lambda *args, **kwargs: BrokenRedis())
    cache = ResponseCache(redis_url="redis://broken", semantic_enabled=False)
    await cache.connect()
    assert cache._redis_available is False

    response = {"id": "3", "choices": [{"message": {"content": "fallback"}}]}
    messages = [{"role": "user", "content": "fallback prompt"}]
    await cache.set("gpt-4o-mini", messages, response)

    assert await cache.get("gpt-4o-mini", messages) == response
