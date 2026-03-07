"""
backend.api.v1.keys — API key management endpoints.

TODO: implement full CRUD for API keys backed by the database.
TODO: add hashed-key storage (never store plaintext secrets).
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/")
async def list_keys() -> dict:
    """List all API keys (stub — returns empty list until DB is wired up)."""
    # TODO: query APIKey model from database
    return {"keys": []}


@router.post("/")
async def create_key(name: str) -> dict:
    """Create a new API key (stub)."""
    # TODO: generate secure random key, hash it, persist to DB
    return {"name": name, "key": "sk-guardian-TODO", "message": "Not yet implemented"}


@router.delete("/{key_id}")
async def revoke_key(key_id: str) -> dict:
    """Revoke an existing API key (stub)."""
    # TODO: mark key as revoked in DB
    return {"key_id": key_id, "revoked": False, "message": "Not yet implemented"}
