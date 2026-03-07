"""
backend.core.router — Smart routing for LLM provider/model selection.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

import structlog
from litellm import acompletion

from backend.core.analytics import AnalyticsCollector, analytics_collector
from backend.core.pricing import estimate_prompt_tokens, pricing_catalog
from backend.core.rules import ModelCandidate, apply_rules
from backend.models.rules import UserRule
from backend.utils.settings import settings

logger = structlog.get_logger(__name__)

CompletionFunc = Callable[..., Awaitable[Any]]
AUTO_MODELS = {"auto", "smart", "router:auto"}


def _messages_require_vision(messages: list[dict[str, Any]]) -> bool:
    for message in messages:
        content = message.get("content")
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "image_url":
                    return True
    return False


class LLMRouter:
    """Routing engine that picks the lowest-cost viable model with latency tie-breaks."""

    def __init__(
        self,
        completion_func: CompletionFunc | None = None,
        analytics: AnalyticsCollector | None = None,
    ) -> None:
        self._completion_func: CompletionFunc = completion_func or acompletion
        self._analytics = analytics or analytics_collector
        self._initialized = False

    def configure(
        self,
        *,
        completion_func: CompletionFunc | None = None,
        analytics: AnalyticsCollector | None = None,
    ) -> None:
        if completion_func is not None:
            self._completion_func = completion_func
        if analytics is not None:
            self._analytics = analytics

    async def init(self) -> None:
        if self._initialized:
            return
        await pricing_catalog.sync_from_url(settings.pricing_catalog_url)
        self._initialized = True
        logger.info("router.initialized", models=len(pricing_catalog.entries))

    async def _build_candidates(self, request_params: dict[str, Any]) -> list[ModelCandidate]:
        messages = request_params.get("messages", [])
        max_tokens = int(
            request_params.get("max_tokens")
            or request_params.get("max_completion_tokens")
            or request_params.get("completion_tokens")
            or 256
        )
        prompt_tokens = estimate_prompt_tokens(messages)
        wants_stream = bool(request_params.get("stream", False))
        wants_vision = bool(request_params.get("vision", False)) or _messages_require_vision(messages)

        candidates: list[ModelCandidate] = []
        for entry in pricing_catalog.list_models():
            if wants_stream and not entry.supports_streaming:
                continue
            if wants_vision and not entry.supports_vision:
                continue
            if max_tokens > entry.max_output_tokens:
                continue
            if prompt_tokens + max_tokens > entry.context_window:
                continue
            estimated_cost = pricing_catalog.calculate_cost(
                entry.model,
                prompt_tokens,
                max_tokens,
            ).cost_usd
            latency_ms = await self._analytics.get_p95_latency(entry.model)
            candidates.append(
                ModelCandidate(
                    model=entry.model,
                    provider=entry.provider,
                    estimated_cost_usd=estimated_cost,
                    p95_latency_ms=latency_ms,
                    supports_vision=entry.supports_vision,
                    supports_streaming=entry.supports_streaming,
                    context_window=entry.context_window,
                    max_output_tokens=entry.max_output_tokens,
                )
            )
        return candidates

    async def select_model(self, request_params: dict[str, Any]) -> str:
        requested_model = str(request_params.get("model", "auto")).strip()
        if requested_model and requested_model not in AUTO_MODELS:
            resolved = pricing_catalog.resolve_model(requested_model)
            return resolved.model if resolved is not None else requested_model

        candidates = await self._build_candidates(request_params)
        rules = [rule for rule in request_params.get("rules", []) if isinstance(rule, UserRule)]
        if rules:
            candidates = apply_rules(candidates, rules)
        if not candidates:
            raise LookupError("No compatible model candidates found")

        selected = min(
            candidates,
            key=lambda candidate: (candidate.estimated_cost_usd, candidate.p95_latency_ms, candidate.model),
        )
        logger.info(
            "router.model_selected",
            model=selected.model,
            provider=selected.provider,
            estimated_cost_usd=selected.estimated_cost_usd,
            latency_ms=selected.p95_latency_ms,
        )
        return selected.model

    async def complete(
        self,
        model: str,
        messages: list[dict[str, Any]],
        **kwargs: Any,
    ) -> Any:
        selected_model = model
        if model in AUTO_MODELS:
            selected_model = await self.select_model({"model": model, "messages": messages, **kwargs})
        logger.info("router.complete", model=selected_model, n_messages=len(messages))
        return await self._completion_func(model=selected_model, messages=messages, **kwargs)


lifespan_router = LLMRouter()
