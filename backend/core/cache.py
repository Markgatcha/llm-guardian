"""
backend.core.cache — Exact and semantic response cache with Redis fallback.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Awaitable, Callable
from typing import Any, cast

import structlog
from litellm import aembedding
from redis.asyncio import Redis

from backend.core.pricing import flatten_messages
from backend.utils.settings import settings

logger = structlog.get_logger(__name__)

EmbeddingFunc = Callable[..., Awaitable[Any]]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return 0.0 if na == 0 or nb == 0 else dot / (na * nb)


def _cache_key(model: str, messages: list[dict[str, Any]]) -> str:
    payload = json.dumps({"model": model, "messages": messages}, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"guardian:cache:{digest}"


class ResponseCache:
    def __init__(
        self,
        redis_url: str | None = None,
        ttl: int | None = None,
        semantic_enabled: bool | None = None,
        threshold: float | None = None,
        embedding_model: str | None = None,
        embedding_func: EmbeddingFunc | None = None,
    ) -> None:
        self._url = redis_url or settings.redis_url
        self._ttl = ttl or settings.cache_ttl_seconds
        self._semantic_enabled = (
            settings.semantic_cache_enabled if semantic_enabled is None else semantic_enabled
        )
        self._threshold = threshold if threshold is not None else settings.semantic_cache_threshold
        self._embedding_model = embedding_model or settings.embedding_model
        self._embedding_func = embedding_func or aembedding
        self._client: Any | None = None
        self._redis_available = False
        self._memory_exact: dict[str, dict[str, Any]] = {}
        self._memory_semantic: dict[str, list[dict[str, Any]]] = {}
        self._semantic_window = max(20, settings.latency_window_size)

    def configure(
        self,
        *,
        redis_url: str | None = None,
        ttl: int | None = None,
        semantic_enabled: bool | None = None,
        threshold: float | None = None,
        embedding_model: str | None = None,
        embedding_func: EmbeddingFunc | None = None,
        client: Any | None = None,
    ) -> None:
        if redis_url is not None:
            self._url = redis_url
        if ttl is not None:
            self._ttl = ttl
        if semantic_enabled is not None:
            self._semantic_enabled = semantic_enabled
        if threshold is not None:
            self._threshold = threshold
        if embedding_model is not None:
            self._embedding_model = embedding_model
        if embedding_func is not None:
            self._embedding_func = embedding_func
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
                self._redis_available = False
                self._client = None

        try:
            client = cast(Any, Redis.from_url(self._url, decode_responses=True))
            await client.ping()
            self._client = client
            self._redis_available = True
            logger.info("cache.connected", url=self._url)
        except Exception:
            self._client = None
            self._redis_available = False
            logger.warning("cache.redis_unavailable", url=self._url)

    async def disconnect(self) -> None:
        if self._client is not None:
            await self._client.aclose()
        self._client = None
        self._redis_available = False

    async def _redis_get(self, key: str) -> str | None:
        if not self._redis_available or self._client is None:
            return None
        try:
            raw = await self._client.get(key)
            return None if raw is None else str(raw)
        except Exception:
            self._redis_available = False
            logger.warning("cache.redis_get_failed", key=key)
            return None

    async def _redis_set(self, key: str, value: str) -> None:
        if not self._redis_available or self._client is None:
            return
        try:
            await self._client.set(key, value, ex=self._ttl)
        except Exception:
            self._redis_available = False
            logger.warning("cache.redis_set_failed", key=key)

    async def _redis_delete(self, key: str) -> None:
        if not self._redis_available or self._client is None:
            return
        try:
            await self._client.delete(key)
        except Exception:
            self._redis_available = False
            logger.warning("cache.redis_delete_failed", key=key)

    async def _redis_lpush(self, key: str, value: str) -> None:
        if not self._redis_available or self._client is None:
            return
        try:
            await self._client.lpush(key, value)
            await self._client.ltrim(key, 0, self._semantic_window - 1)
        except Exception:
            self._redis_available = False
            logger.warning("cache.redis_list_failed", key=key)

    async def _redis_lrange(self, key: str) -> list[str]:
        if not self._redis_available or self._client is None:
            return []
        try:
            return [str(value) for value in await self._client.lrange(key, 0, self._semantic_window - 1)]
        except Exception:
            self._redis_available = False
            logger.warning("cache.redis_lrange_failed", key=key)
            return []

    async def _embed_messages(self, messages: list[dict[str, Any]]) -> list[float] | None:
        if not self._semantic_enabled:
            return None
        prompt = flatten_messages(messages)
        if not prompt:
            return None
        try:
            response = await self._embedding_func(model=self._embedding_model, input=[prompt])
        except Exception as exc:
            logger.warning("cache.embedding_failed", model=self._embedding_model, error=str(exc))
            return None

        data = response.get("data") if isinstance(response, dict) else getattr(response, "data", None)
        if not data:
            return None
        first = data[0]
        embedding = first.get("embedding") if isinstance(first, dict) else getattr(first, "embedding", None)
        if embedding is None:
            return None
        return [float(value) for value in embedding]

    async def _get_semantic(self, model: str, messages: list[dict[str, Any]]) -> dict[str, Any] | None:
        embedding = await self._embed_messages(messages)
        if embedding is None:
            return None

        semantic_key = f"guardian:semantic:{model}"
        serialized_entries = await self._redis_lrange(semantic_key)
        if not serialized_entries:
            serialized_entries = [
                json.dumps(entry) for entry in self._memory_semantic.get(model, [])[-self._semantic_window :]
            ]

        best_match: tuple[float, dict[str, Any]] | None = None
        for raw_entry in serialized_entries:
            try:
                entry = json.loads(raw_entry)
            except json.JSONDecodeError:
                continue
            stored_embedding = entry.get("embedding")
            response = entry.get("response")
            if not isinstance(stored_embedding, list) or not isinstance(response, dict):
                continue
            score = cosine_similarity(embedding, [float(value) for value in stored_embedding])
            if score >= self._threshold and (best_match is None or score > best_match[0]):
                best_match = (score, response)

        if best_match is None:
            return None
        logger.debug("cache.semantic_hit", model=model, score=best_match[0])
        return best_match[1]

    async def get(self, model: str, messages: list[dict[str, Any]]) -> dict[str, Any] | None:
        key = _cache_key(model, messages)
        raw = await self._redis_get(key)
        if raw is not None:
            logger.debug("cache.exact_hit", key=key)
            return dict(json.loads(raw))

        memory_hit = self._memory_exact.get(key)
        if memory_hit is not None:
            logger.debug("cache.memory_hit", key=key)
            return memory_hit

        logger.debug("cache.miss", key=key)
        return await self._get_semantic(model, messages)

    async def set(self, model: str, messages: list[dict[str, Any]], response: dict[str, Any]) -> None:
        key = _cache_key(model, messages)
        payload = json.dumps(response)
        self._memory_exact[key] = response
        await self._redis_set(key, payload)

        if not self._semantic_enabled:
            return

        embedding = await self._embed_messages(messages)
        if embedding is None:
            return
        semantic_entry = {
            "cache_key": key,
            "embedding": embedding,
            "response": response,
        }
        self._memory_semantic.setdefault(model, []).append(semantic_entry)
        self._memory_semantic[model] = self._memory_semantic[model][-self._semantic_window :]
        await self._redis_lpush(f"guardian:semantic:{model}", json.dumps(semantic_entry))

    async def invalidate(self, model: str, messages: list[dict[str, Any]]) -> None:
        key = _cache_key(model, messages)
        self._memory_exact.pop(key, None)
        await self._redis_delete(key)


lifespan_cache = ResponseCache()
