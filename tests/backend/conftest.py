"""
tests/backend/conftest.py — Shared fixtures for backend tests.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import backend.models.api_key  # noqa: F401
import backend.models.request_log  # noqa: F401
import backend.models.rules  # noqa: F401
import pytest
import pytest_asyncio
from backend.core.analytics import analytics_collector
from backend.core.cache import lifespan_cache
from backend.core.pricing import pricing_catalog
from backend.core.router import lifespan_router
from backend.models.base import Base
from backend.utils import db as db_module
from backend.utils.settings import settings
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool


class FakeRedis:
    def __init__(self) -> None:
        self._kv: dict[str, str] = {}
        self._lists: dict[str, list[str]] = {}

    async def ping(self) -> bool:
        return True

    async def aclose(self) -> None:
        return None

    async def get(self, key: str) -> str | None:
        return self._kv.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> bool:
        self._kv[key] = value
        return True

    async def delete(self, key: str) -> int:
        existed = int(key in self._kv or key in self._lists)
        self._kv.pop(key, None)
        self._lists.pop(key, None)
        return existed

    async def lpush(self, key: str, value: Any) -> int:
        values = self._lists.setdefault(key, [])
        values.insert(0, str(value))
        return len(values)

    async def ltrim(self, key: str, start: int, stop: int) -> bool:
        values = self._lists.setdefault(key, [])
        self._lists[key] = values[start : stop + 1]
        return True

    async def lrange(self, key: str, start: int, stop: int) -> list[str]:
        values = self._lists.get(key, [])
        return values[start : stop + 1]


class MockUsage:
    def __init__(self, prompt_tokens: int = 10, completion_tokens: int = 20) -> None:
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.total_tokens = prompt_tokens + completion_tokens

    def model_dump(self) -> dict[str, int]:
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
        }


class MockModelResponse:
    def __init__(self, model: str, content: str = "Mock response") -> None:
        self.id = "mock-id"
        self.object = "chat.completion"
        self.created = 1_717_171_717
        self.model = model
        self.choices = [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ]
        self.usage = MockUsage()

    def model_dump(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "object": self.object,
            "created": self.created,
            "model": self.model,
            "choices": self.choices,
            "usage": self.usage.model_dump(),
        }


class MockStream:
    def __init__(self, model: str) -> None:
        self._chunks = [
            {
                "id": "mock-stream-id",
                "object": "chat.completion.chunk",
                "created": 1_717_171_717,
                "model": model,
                "choices": [{"index": 0, "delta": {"role": "assistant", "content": "Mock "}}],
            },
            {
                "id": "mock-stream-id",
                "object": "chat.completion.chunk",
                "created": 1_717_171_717,
                "model": model,
                "choices": [{"index": 0, "delta": {"content": "response"}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
            },
        ]
        self._index = 0

    def __aiter__(self) -> MockStream:
        return self

    async def __anext__(self) -> dict[str, Any]:
        if self._index >= len(self._chunks):
            raise StopAsyncIteration
        chunk = self._chunks[self._index]
        self._index += 1
        return chunk


async def mock_acompletion(*, model: str, messages: list[dict[str, Any]], stream: bool | None = None, **kwargs: Any) -> Any:
    if stream:
        return MockStream(model)
    user_text = " ".join(str(message.get("content", "")) for message in messages)
    return MockModelResponse(model=model, content=f"Mock response to {user_text}".strip())


def _text_embedding(text: str) -> list[float]:
    text = text.lower()
    return [
        float(len(text)),
        float(sum(1 for char in text if char in "aeiou")),
        float(sum(1 for char in text if char.isalpha())),
        float(text.count(" ")),
    ]


async def mock_aembedding(*, model: str, input: list[str], **kwargs: Any) -> dict[str, Any]:
    return {"data": [{"embedding": _text_embedding(input[0])}]}


@pytest.fixture
def fake_redis() -> FakeRedis:
    return FakeRedis()


@pytest_asyncio.fixture
async def session_factory(monkeypatch: pytest.MonkeyPatch, fake_redis: FakeRedis) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False, class_=AsyncSession)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    db_module.engine = engine
    db_module.SessionLocal = factory
    monkeypatch.setattr("backend.main.SessionLocal", factory)
    settings.admin_api_keys = ["guardian-admin-test-key"]
    settings.semantic_cache_enabled = True
    settings.semantic_cache_threshold = 0.90
    settings.embedding_model = "mock-embedding-model"
    settings.baseline_model = "gpt-4o"
    settings.redis_url = "redis://fake"

    pricing_catalog.reset()
    analytics_collector._buffer.clear()
    analytics_collector._memory_latency.clear()
    analytics_collector.configure(redis_url=settings.redis_url, session_factory=factory, client=fake_redis)
    lifespan_cache._memory_exact.clear()
    lifespan_cache._memory_semantic.clear()
    lifespan_cache.configure(
        redis_url=settings.redis_url,
        client=fake_redis,
        embedding_func=mock_aembedding,
        semantic_enabled=True,
        threshold=0.90,
        embedding_model=settings.embedding_model,
    )
    lifespan_router.configure(completion_func=mock_acompletion, analytics=analytics_collector)
    lifespan_router._initialized = False

    try:
        yield factory
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def app(session_factory: async_sessionmaker[AsyncSession]) -> AsyncIterator[Any]:
    from backend.main import create_app

    application = create_app()
    async with application.router.lifespan_context(application):
        yield application


@pytest_asyncio.fixture
async def client(app: Any) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as async_client:
        yield async_client


@pytest_asyncio.fixture
async def db_session(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    async with session_factory() as session:
        yield session


@pytest.fixture
def admin_headers() -> dict[str, str]:
    return {"X-Guardian-Key": "guardian-admin-test-key"}
