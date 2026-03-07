"""
tests/backend/test_health.py — Smoke tests for the /health and root endpoints.
"""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_health_returns_ok(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_docs_accessible(client):
    """OpenAPI docs should be served in non-production environments."""
    response = await client.get("/docs")
    assert response.status_code == 200
