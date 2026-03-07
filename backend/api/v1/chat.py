"""
backend.api.v1.chat — Proxy chat-completion requests through the guardian.

Applies guardrails → cache check → LLM routing → cost accounting → analytics.

TODO: implement streaming (SSE) response path.
TODO: add per-key rate limiting middleware.
"""

from __future__ import annotations

import time
import uuid

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from backend.core.analytics import RequestEvent, analytics_collector
from backend.core.cache import lifespan_cache
from backend.core.guardrails import guardrails_engine
from backend.core.pricing import calculate_cost
from backend.core.router import lifespan_router

router = APIRouter()


class ChatRequest(BaseModel):
    model: str = "gpt-4o-mini"
    messages: list[dict]
    temperature: float = 0.7
    max_tokens: int = 1024
    stream: bool = False


class ChatResponse(BaseModel):
    id: str
    model: str
    choices: list[dict]
    usage: dict
    cost_usd: float
    cached: bool = False


@router.post("/completions", response_model=ChatResponse, status_code=status.HTTP_200_OK)
async def chat_completions(request: ChatRequest) -> ChatResponse:
    """
    Guardian-proxied chat completions endpoint.

    Mirrors the OpenAI ``POST /v1/chat/completions`` contract so existing
    clients can point at this endpoint with minimal changes.
    """
    request_id = str(uuid.uuid4())
    t0 = time.monotonic()

    # 1. Guardrails
    check = guardrails_engine.check_input(request.messages)
    if not check.allowed:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=check.message)

    # 2. Cache lookup
    cached_response = await lifespan_cache.get(request.model, request.messages)
    if cached_response:
        latency_ms = (time.monotonic() - t0) * 1000
        analytics_collector.record(
            RequestEvent(
                request_id=request_id,
                model=request.model,
                prompt_tokens=cached_response.get("usage", {}).get("prompt_tokens", 0),
                completion_tokens=cached_response.get("usage", {}).get("completion_tokens", 0),
                cost_usd=0.0,
                latency_ms=latency_ms,
                status="cached",
            )
        )
        return ChatResponse(**cached_response, cached=True)

    # 3. LLM call
    response = await lifespan_router.complete(
        model=request.model,
        messages=request.messages,
        temperature=request.temperature,
        max_tokens=request.max_tokens,
    )

    usage = response.usage  # type: ignore[attr-defined]
    cost_record = calculate_cost(request.model, usage.prompt_tokens, usage.completion_tokens)
    latency_ms = (time.monotonic() - t0) * 1000

    # 4. Store in cache
    response_dict = response.model_dump()  # type: ignore[attr-defined]
    await lifespan_cache.set(request.model, request.messages, response_dict)

    # 5. Analytics
    analytics_collector.record(
        RequestEvent(
            request_id=request_id,
            model=request.model,
            prompt_tokens=usage.prompt_tokens,
            completion_tokens=usage.completion_tokens,
            cost_usd=cost_record.cost_usd,
            latency_ms=latency_ms,
            status="ok",
        )
    )

    return ChatResponse(
        id=request_id,
        model=request.model,
        choices=response_dict.get("choices", []),
        usage=usage.__dict__,
        cost_usd=cost_record.cost_usd,
        cached=False,
    )
