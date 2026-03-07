"""
tests/backend/conftest.py — pytest fixtures shared across the backend test suite.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from backend.main import create_app


@pytest.fixture(scope="session")
def app():
    """Return the FastAPI application under test."""
    return create_app()


@pytest_asyncio.fixture
async def client(app):
    """Async HTTP client wired directly to the ASGI app (no network)."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac
