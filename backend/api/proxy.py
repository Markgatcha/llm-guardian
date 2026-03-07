"""
backend.api.proxy — OpenAI-compatible proxy endpoints exposed at /v1.
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.analytics import RequestEvent, analytics_collector
from backend.core.cache import lifespan_cache
from backend.core.guardrails import guardrails_engine
from backend.core.pricing import calculate_cost, pricing_catalog
from backend.core.router import lifespan_router
from backend.models.rules import UserRule
from backend.utils.db import get_session

logger = structlog.get_logger(__name__)

router = APIRouter()
SessionDep = Annotated[AsyncSession, Depends(get_session)]


def _truthy(value: str | bool | None) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _normalize_payload(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict):
        return payload
    if hasattr(payload, "model_dump"):
        return dict(payload.model_dump())
    if hasattr(payload, "__dict__"):
        return dict(payload.__dict__)
    raise TypeError("Unsupported LiteLLM payload type")


def _extract_usage(payload: Any) -> dict[str, int]:
    if isinstance(payload, dict):
        usage = payload.get("usage", {})
    else:
        usage = getattr(payload, "usage", {}) or {}
    if hasattr(usage, "model_dump"):
        usage = usage.model_dump()
    elif hasattr(usage, "__dict__"):
        usage = dict(usage.__dict__)
    return {
        "prompt_tokens": int(usage.get("prompt_tokens", 0)),
        "completion_tokens": int(usage.get("completion_tokens", 0)),
        "total_tokens": int(usage.get("total_tokens", 0)),
    }


def _response_headers(
    *,
    model: str,
    estimated_cost_usd: float,
    actual_cost_usd: float | None = None,
    cache_hit: bool = False,
) -> dict[str, str]:
    headers = {
        "X-Guardian-Model": model,
        "X-Guardian-Estimated-Cost-Usd": f"{estimated_cost_usd:.8f}",
        "X-Guardian-Cache": "hit" if cache_hit else "miss",
    }
    if actual_cost_usd is not None:
        headers["X-Guardian-Actual-Cost-Usd"] = f"{actual_cost_usd:.8f}"
    return headers


def _assistant_text_from_choice(choice: dict[str, Any]) -> str:
    message = choice.get("message", {})
    if isinstance(message, dict):
        return str(message.get("content", ""))
    return str(choice.get("text", ""))


def _build_completion_response(chat_payload: dict[str, Any]) -> dict[str, Any]:
    choices = []
    for choice in chat_payload.get("choices", []):
        choices.append(
            {
                "text": _assistant_text_from_choice(choice),
                "index": choice.get("index", 0),
                "logprobs": None,
                "finish_reason": choice.get("finish_reason", "stop"),
            }
        )
    return {
        "id": chat_payload.get("id", f"cmpl-{uuid.uuid4()}"),
        "object": "text_completion",
        "created": chat_payload.get("created", int(time.time())),
        "model": chat_payload.get("model", "unknown"),
        "choices": choices,
        "usage": chat_payload.get("usage", {}),
    }


def _build_cached_stream_chunk(response_payload: dict[str, Any]) -> dict[str, Any]:
    content = ""
    choices = response_payload.get("choices", [])
    if choices:
        content = _assistant_text_from_choice(choices[0])
    return {
        "id": response_payload.get("id", f"chatcmpl-{uuid.uuid4()}"),
        "object": "chat.completion.chunk",
        "created": response_payload.get("created", int(time.time())),
        "model": response_payload.get("model", "unknown"),
        "choices": [
            {
                "index": 0,
                "delta": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
    }


def _extract_delta_text(chunk_payload: dict[str, Any]) -> str:
    for choice in chunk_payload.get("choices", []):
        delta = choice.get("delta", {})
        if isinstance(delta, dict) and delta.get("content"):
            return str(delta["content"])
    return ""


async def _load_active_rules(session: AsyncSession) -> list[UserRule]:
    result = await session.execute(
        select(UserRule).where(UserRule.is_active.is_(True)).order_by(UserRule.priority.desc())
    )
    return list(result.scalars().all())


class ChatCompletionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    model: str
    messages: list[dict[str, Any]]
    temperature: float | None = 1.0
    max_tokens: int | None = None
    stream: bool = False
    guardian_preview_cost: bool = False
    guardian_confirm_expensive: bool = False


class CompletionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    model: str
    prompt: str | list[str]
    temperature: float | None = 1.0
    max_tokens: int | None = None
    stream: bool = False
    guardian_preview_cost: bool = False
    guardian_confirm_expensive: bool = False


async def _chat_stream_response(
    stream: Any,
    *,
    selected_model: str,
    messages: list[dict[str, Any]],
    request_id: str,
) -> StreamingResponse:
    prompt_tokens = 0
    completion_tokens = 0
    actual_model = selected_model
    collected_text: list[str] = []
    start_time = time.monotonic()

    async def stream_chunks() -> Any:
        nonlocal prompt_tokens, completion_tokens, actual_model

        async for chunk in stream:
            chunk_payload = _normalize_payload(chunk)
            actual_model = str(chunk_payload.get("model", actual_model))
            usage = _extract_usage(chunk_payload)
            prompt_tokens = max(prompt_tokens, usage["prompt_tokens"])
            completion_tokens = max(completion_tokens, usage["completion_tokens"])
            delta_text = _extract_delta_text(chunk_payload)
            if delta_text:
                collected_text.append(delta_text)
            yield f"data: {json.dumps(chunk_payload)}\n\n"

        prompt_tokens = prompt_tokens or 1
        if completion_tokens == 0 and collected_text:
            completion_tokens = max(1, len("".join(collected_text)) // 4)
        baseline_cost_usd, saved_usd = pricing_catalog.calculate_savings(
            actual_model,
            prompt_tokens,
            completion_tokens,
        )
        latency_ms = (time.monotonic() - start_time) * 1000
        analytics_collector.record(
            RequestEvent(
                request_id=request_id,
                model=actual_model,
                provider=pricing_catalog.get_provider(actual_model),
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cost_usd=calculate_cost(actual_model, prompt_tokens, completion_tokens).cost_usd,
                baseline_cost_usd=baseline_cost_usd,
                saved_usd=saved_usd,
                latency_ms=latency_ms,
                status="ok",
            )
        )
        await analytics_collector.update_latency(actual_model, latency_ms)
        if collected_text:
            cached_payload = {
                "id": request_id,
                "object": "chat.completion",
                "created": int(time.time()),
                "model": actual_model,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "".join(collected_text)},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": prompt_tokens + completion_tokens,
                },
            }
            await lifespan_cache.set(actual_model, messages, cached_payload)
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream_chunks(), media_type="text/event-stream")


async def process_chat_completion(
    payload: ChatCompletionRequest,
    *,
    request: Request,
    session: AsyncSession,
) -> JSONResponse | StreamingResponse:
    request_id = str(uuid.uuid4())
    start_time = time.monotonic()
    rules = await _load_active_rules(session)

    selected_model = await lifespan_router.select_model(
        {
            "model": payload.model,
            "messages": payload.messages,
            "max_tokens": payload.max_tokens,
            "stream": payload.stream,
            "rules": rules,
        }
    )

    guardrail_result = guardrails_engine.check_input(payload.messages)
    if not guardrail_result.allowed:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=guardrail_result.message)

    estimated_cost = guardrails_engine.estimate_cost(
        selected_model,
        payload.messages,
        payload.max_tokens or 0,
    )
    confirmation_result = guardrails_engine.check_confirmation(
        estimated_cost,
        confirmed=_truthy(request.headers.get("X-Guardian-Confirm-Expensive"))
        or payload.guardian_confirm_expensive,
    )
    if not confirmation_result.allowed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=confirmation_result.message)

    budget_result = await guardrails_engine.check_budget(estimated_cost, session)
    if not budget_result.allowed:
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=budget_result.message)

    headers = _response_headers(model=selected_model, estimated_cost_usd=estimated_cost)

    if _truthy(request.headers.get("X-Guardian-Preview-Only")) or payload.guardian_preview_cost:
        return JSONResponse(
            {
                "id": request_id,
                "object": "guardian.cost_preview",
                "created": int(time.time()),
                "model": selected_model,
                "provider": pricing_catalog.get_provider(selected_model),
                "estimated_cost_usd": estimated_cost,
            },
            headers=headers,
        )

    cached_response = await lifespan_cache.get(selected_model, payload.messages)
    if cached_response is not None:
        latency_ms = (time.monotonic() - start_time) * 1000
        usage = _extract_usage(cached_response)
        baseline_cost_usd, saved_usd = pricing_catalog.calculate_savings(
            selected_model,
            usage["prompt_tokens"],
            usage["completion_tokens"],
        )
        analytics_collector.record(
            RequestEvent(
                request_id=request_id,
                model=selected_model,
                provider=pricing_catalog.get_provider(selected_model),
                prompt_tokens=usage["prompt_tokens"],
                completion_tokens=usage["completion_tokens"],
                cost_usd=0.0,
                baseline_cost_usd=baseline_cost_usd,
                saved_usd=saved_usd,
                latency_ms=latency_ms,
                status="cached",
                cache_hit=True,
            )
        )
        await analytics_collector.update_latency(selected_model, latency_ms)
        cache_headers = _response_headers(
            model=selected_model,
            estimated_cost_usd=estimated_cost,
            actual_cost_usd=0.0,
            cache_hit=True,
        )
        if payload.stream:
            async def cached_stream() -> Any:
                yield f"data: {json.dumps(_build_cached_stream_chunk(cached_response))}\n\n"
                yield "data: [DONE]\n\n"

            return StreamingResponse(
                cached_stream(),
                media_type="text/event-stream",
                headers=cache_headers,
            )
        return JSONResponse(cached_response, headers=cache_headers)

    stream_or_response = await lifespan_router.complete(
        model=selected_model,
        messages=payload.messages,
        temperature=payload.temperature,
        max_tokens=payload.max_tokens,
        stream=payload.stream,
    )

    if payload.stream:
        stream_response = await _chat_stream_response(
            stream_or_response,
            selected_model=selected_model,
            messages=payload.messages,
            request_id=request_id,
        )
        stream_response.headers.update(headers)
        return stream_response

    response_payload = _normalize_payload(stream_or_response)
    usage = _extract_usage(stream_or_response)
    actual_model = str(response_payload.get("model", selected_model))
    actual_cost = calculate_cost(
        actual_model,
        usage["prompt_tokens"],
        usage["completion_tokens"],
    ).cost_usd
    baseline_cost_usd, saved_usd = pricing_catalog.calculate_savings(
        actual_model,
        usage["prompt_tokens"],
        usage["completion_tokens"],
    )
    latency_ms = (time.monotonic() - start_time) * 1000

    response_payload.setdefault("id", request_id)
    response_payload.setdefault("object", "chat.completion")
    response_payload.setdefault("created", int(time.time()))
    response_payload.setdefault("model", actual_model)
    response_payload["usage"] = usage

    await lifespan_cache.set(actual_model, payload.messages, response_payload)
    analytics_collector.record(
        RequestEvent(
            request_id=request_id,
            model=actual_model,
            provider=pricing_catalog.get_provider(actual_model),
            prompt_tokens=usage["prompt_tokens"],
            completion_tokens=usage["completion_tokens"],
            cost_usd=actual_cost,
            baseline_cost_usd=baseline_cost_usd,
            saved_usd=saved_usd,
            latency_ms=latency_ms,
            status="ok",
        )
    )
    await analytics_collector.update_latency(actual_model, latency_ms)

    headers = _response_headers(
        model=actual_model,
        estimated_cost_usd=estimated_cost,
        actual_cost_usd=actual_cost,
        cache_hit=False,
    )
    return JSONResponse(response_payload, headers=headers)


@router.post("/chat/completions", response_model=None)
async def chat_completions(
    payload: ChatCompletionRequest,
    request: Request,
    session: SessionDep,
) -> JSONResponse | StreamingResponse:
    return await process_chat_completion(payload, request=request, session=session)


@router.post("/completions", response_model=None)
async def completions(
    payload: CompletionRequest,
    request: Request,
    session: SessionDep,
) -> JSONResponse:
    prompt_text = payload.prompt if isinstance(payload.prompt, str) else "\n".join(payload.prompt)
    chat_payload = ChatCompletionRequest(
        model=payload.model,
        messages=[{"role": "user", "content": prompt_text}],
        temperature=payload.temperature,
        max_tokens=payload.max_tokens,
        stream=False,
        guardian_preview_cost=payload.guardian_preview_cost,
        guardian_confirm_expensive=payload.guardian_confirm_expensive,
    )
    response = await process_chat_completion(chat_payload, request=request, session=session)
    if isinstance(response, StreamingResponse):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Streaming not supported here.")
    raw_body = response.body if isinstance(response.body, bytes) else bytes(response.body)
    chat_payload_dict = json.loads(raw_body.decode("utf-8"))
    completion_payload = _build_completion_response(chat_payload_dict)
    return JSONResponse(completion_payload, headers=dict(response.headers))
