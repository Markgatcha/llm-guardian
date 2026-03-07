"""
tests/backend/test_health.py — Smoke tests for the /health and root endpoints.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_returns_ok(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_docs_accessible(client: AsyncClient) -> None:
    """OpenAPI docs should be served in non-production environments."""
    response = await client.get("/docs")
    assert response.status_code == 200
