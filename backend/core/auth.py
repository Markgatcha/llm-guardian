"""
backend.core.auth — Admin API key hashing, bootstrap, and authentication.
"""

from __future__ import annotations

import secrets
from typing import Annotated

import structlog
from fastapi import Depends, HTTPException, Request, status
from passlib.context import CryptContext
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.api_key import APIKey
from backend.utils.db import get_session
from backend.utils.settings import settings

logger = structlog.get_logger(__name__)

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
SessionDep = Annotated[AsyncSession, Depends(get_session)]


def hash_api_key(raw_key: str) -> str:
    return str(pwd_context.hash(raw_key))


def verify_api_key(raw_key: str, hashed_key: str) -> bool:
    return bool(pwd_context.verify(raw_key, hashed_key))


def generate_api_key() -> str:
    return f"sk-guardian-{secrets.token_urlsafe(32)}"


def extract_admin_key(request: Request) -> str | None:
    header_key = request.headers.get("X-Guardian-Key")
    if header_key:
        return header_key.strip()
    authorization = request.headers.get("Authorization", "")
    if authorization.lower().startswith("bearer "):
        bearer_key = authorization[7:].strip()
        if bearer_key:
            return bearer_key
    return None


async def bootstrap_admin_api_keys(session: AsyncSession) -> None:
    bootstrap_keys = [
        raw_key
        for raw_key in dict.fromkeys([*settings.admin_api_keys, settings.guardian_api_key])
        if raw_key
    ]
    if not bootstrap_keys:
        return

    existing_count = await session.scalar(select(func.count()).select_from(APIKey))
    if int(existing_count or 0) > 0:
        return

    for index, raw_key in enumerate(bootstrap_keys, start=1):
        session.add(
            APIKey(
                name=f"bootstrap-{index}",
                hashed_key=hash_api_key(raw_key),
                is_active=True,
            )
        )
    await session.commit()
    logger.info("auth.bootstrap_keys_created", count=len(bootstrap_keys))


async def authenticate_admin_key(
    request: Request,
    session: SessionDep,
) -> APIKey:
    raw_key = extract_admin_key(request)
    if not raw_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing admin API key",
        )

    result = await session.execute(select(APIKey).where(APIKey.is_active.is_(True)))
    for api_key in result.scalars():
        try:
            if verify_api_key(raw_key, api_key.hashed_key):
                return api_key
        except Exception:
            logger.warning("auth.verify_failed", key_id=api_key.id)

    logger.warning("auth.invalid_key")
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid admin API key",
    )


async def require_admin(
    api_key: Annotated[APIKey, Depends(authenticate_admin_key)],
) -> APIKey:
    return api_key
