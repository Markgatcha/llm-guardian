"""
backend.core.cache — Redis-backed semantic and exact-match response cache.

Responsibilities:
- Exact-match cache keyed on (model, normalised messages hash).
- Semantic cache (future): embed prompt and search via Redis Vector Similarity.
- TTL management and cache invalidation helpers.

TODO: implement semantic embedding lookup using Redis VSS.
TODO: add per-key TTL override based on model or request headers.
"""

from __future__ import annotations

import hashlib
import json

import structlog
from redis.asyncio import Redis

logger = structlog.get_logger(__name__)


def _cache_key(model: str, messages: list[dict]) -> str:
    """Deterministic cache key for a (model, messages) pair."""
    payload = json.dumps({"model": model, "messages": messages}, sort_keys=True)
    digest = hashlib.sha256(payload.encode()).hexdigest()
    return f"guardian:cache:{digest}"


class ResponseCache:
    """Async Redis cache for LLM responses."""

    def __init__(self, redis_url: str = "redis://localhost:6379/0", ttl: int = 300) -> None:
        self._url = redis_url
        self._ttl = ttl
        self._client: Redis | None = None

    async def connect(self) -> None:
        """Open the Redis connection pool."""
        self._client = Redis.from_url(self._url, decode_responses=True)
        logger.info("cache.connected", url=self._url)

    async def disconnect(self) -> None:
        """Close the Redis connection pool."""
        if self._client:
            await self._client.aclose()
            logger.info("cache.disconnected")

    @property
    def client(self) -> Redis:
        if self._client is None:
            raise RuntimeError("Cache not connected — call connect() first.")
        return self._client

    async def get(self, model: str, messages: list[dict]) -> dict | None:
        """Return a cached response or ``None`` on cache miss."""
        key = _cache_key(model, messages)
        raw = await self.client.get(key)
        if raw is None:
            logger.debug("cache.miss", key=key)
            return None
        logger.debug("cache.hit", key=key)
        return json.loads(raw)  # type: ignore[return-value]

    async def set(self, model: str, messages: list[dict], response: dict) -> None:
        """Store a response with the configured TTL."""
        key = _cache_key(model, messages)
        await self.client.set(key, json.dumps(response), ex=self._ttl)
        logger.debug("cache.set", key=key, ttl=self._ttl)

    async def invalidate(self, model: str, messages: list[dict]) -> None:
        """Manually evict a single cache entry."""
        key = _cache_key(model, messages)
        await self.client.delete(key)
        logger.debug("cache.invalidated", key=key)


# Module-level singleton — connected during app startup via lifespan.
lifespan_cache = ResponseCache()
