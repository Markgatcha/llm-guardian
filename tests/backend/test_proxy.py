from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_chat_completions_proxy_returns_openai_shape(client: AsyncClient) -> None:
    response = await client.post(
        "/v1/chat/completions",
        json={"model": "auto", "messages": [{"role": "user", "content": "hello world"}]},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["object"] == "chat.completion"
    assert payload["choices"][0]["message"]["content"].startswith("Mock response")
    assert payload["usage"]["total_tokens"] == 30
    assert response.headers["X-Guardian-Model"] == "gpt-4o-mini"
    assert float(response.headers["X-Guardian-Estimated-Cost-Usd"]) > 0


@pytest.mark.asyncio
async def test_completions_proxy_returns_text_completion_shape(client: AsyncClient) -> None:
    response = await client.post(
        "/v1/completions",
        json={"model": "auto", "prompt": "summarize this"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["object"] == "text_completion"
    assert payload["choices"][0]["text"].startswith("Mock response")
    assert payload["usage"]["total_tokens"] == 30


@pytest.mark.asyncio
async def test_chat_completions_streaming_returns_sse(client: AsyncClient) -> None:
    async with client.stream(
        "POST",
        "/v1/chat/completions",
        json={"model": "auto", "messages": [{"role": "user", "content": "stream it"}], "stream": True},
    ) as response:
        body = "".join([chunk async for chunk in response.aiter_text()])

    assert response.status_code == 200
    assert "data: " in body
    assert "Mock " in body
    assert "[DONE]" in body


@pytest.mark.asyncio
async def test_chat_completions_cost_preview(client: AsyncClient) -> None:
    response = await client.post(
        "/v1/chat/completions",
        json={
            "model": "auto",
            "messages": [{"role": "user", "content": "preview the cost"}],
            "guardian_preview_cost": True,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["object"] == "guardian.cost_preview"
    assert payload["model"] == "gpt-4o-mini"
    assert payload["estimated_cost_usd"] > 0
