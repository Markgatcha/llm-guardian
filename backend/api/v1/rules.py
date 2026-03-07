"""
backend.api.v1.rules — CRUD endpoints for routing rules.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.auth import require_admin
from backend.models.rules import UserRule
from backend.utils.db import get_session

router = APIRouter(dependencies=[Depends(require_admin)])
SessionDep = Annotated[AsyncSession, Depends(get_session)]


def _serialize_rule(rule: UserRule) -> dict[str, Any]:
    return {
        "id": rule.id,
        "name": rule.name,
        "rule_type": rule.rule_type,
        "value": rule.value,
        "priority": rule.priority,
        "is_active": rule.is_active,
        "created_at": rule.created_at.isoformat() if isinstance(rule.created_at, datetime) else None,
        "updated_at": rule.updated_at.isoformat() if isinstance(rule.updated_at, datetime) else None,
    }


class RuleCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    rule_type: str = Field(min_length=1, max_length=64)
    value: dict[str, Any] = Field(default_factory=dict)
    priority: int = 100
    is_active: bool = True


class RuleUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    rule_type: str | None = Field(default=None, min_length=1, max_length=64)
    value: dict[str, Any] | None = None
    priority: int | None = None
    is_active: bool | None = None


@router.get("")
async def list_rules(session: SessionDep) -> dict[str, Any]:
    result = await session.execute(select(UserRule).order_by(UserRule.priority.desc(), UserRule.created_at))
    return {"rules": [_serialize_rule(rule) for rule in result.scalars().all()]}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_rule(
    payload: RuleCreateRequest,
    session: SessionDep,
) -> dict[str, Any]:
    rule = UserRule(
        name=payload.name,
        rule_type=payload.rule_type,
        value=payload.value,
        priority=payload.priority,
        is_active=payload.is_active,
    )
    session.add(rule)
    await session.flush()
    return _serialize_rule(rule)


@router.get("/{rule_id}")
async def get_rule(rule_id: str, session: SessionDep) -> dict[str, Any]:
    rule = await session.get(UserRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rule not found")
    return _serialize_rule(rule)


@router.patch("/{rule_id}")
async def update_rule(
    rule_id: str,
    payload: RuleUpdateRequest,
    session: SessionDep,
) -> dict[str, Any]:
    rule = await session.get(UserRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rule not found")
    updates = payload.model_dump(exclude_none=True)
    for field_name, value in updates.items():
        setattr(rule, field_name, value)
    await session.flush()
    return _serialize_rule(rule)


@router.delete("/{rule_id}")
async def delete_rule(rule_id: str, session: SessionDep) -> dict[str, Any]:
    rule = await session.get(UserRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rule not found")
    await session.delete(rule)
    return {"deleted": True, "id": rule_id}
