"""
backend.api.v1.keys — Admin API key CRUD endpoints.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.auth import generate_api_key, hash_api_key, require_admin
from backend.models.api_key import APIKey
from backend.utils.db import get_session

router = APIRouter(dependencies=[Depends(require_admin)])
SessionDep = Annotated[AsyncSession, Depends(get_session)]


def _serialize_key(api_key: APIKey) -> dict[str, Any]:
    return {
        "id": api_key.id,
        "name": api_key.name,
        "is_active": api_key.is_active,
        "created_at": api_key.created_at.isoformat() if isinstance(api_key.created_at, datetime) else None,
        "updated_at": api_key.updated_at.isoformat() if isinstance(api_key.updated_at, datetime) else None,
    }


class KeyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)


class KeyUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    is_active: bool | None = None


@router.get("")
async def list_keys(session: SessionDep) -> dict[str, Any]:
    result = await session.execute(select(APIKey).order_by(APIKey.created_at.desc()))
    return {"keys": [_serialize_key(api_key) for api_key in result.scalars().all()]}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_key(
    payload: KeyCreateRequest,
    session: SessionDep,
) -> dict[str, Any]:
    raw_key = generate_api_key()
    api_key = APIKey(name=payload.name, hashed_key=hash_api_key(raw_key), is_active=True)
    session.add(api_key)
    await session.flush()
    return {**_serialize_key(api_key), "key": raw_key}


@router.get("/{key_id}")
async def get_key(key_id: str, session: SessionDep) -> dict[str, Any]:
    api_key = await session.get(APIKey, key_id)
    if api_key is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Key not found")
    return _serialize_key(api_key)


@router.patch("/{key_id}")
async def update_key(
    key_id: str,
    payload: KeyUpdateRequest,
    session: SessionDep,
) -> dict[str, Any]:
    api_key = await session.get(APIKey, key_id)
    if api_key is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Key not found")
    if payload.name is not None:
        api_key.name = payload.name
    if payload.is_active is not None:
        api_key.is_active = payload.is_active
    await session.flush()
    return _serialize_key(api_key)


@router.delete("/{key_id}")
async def delete_key(key_id: str, session: SessionDep) -> dict[str, Any]:
    api_key = await session.get(APIKey, key_id)
    if api_key is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Key not found")
    await session.delete(api_key)
    return {"deleted": True, "id": key_id}
