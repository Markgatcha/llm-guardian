"""
backend.models.rules — Routing and spending rules persisted in the database.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import Base, TimestampMixin, UUIDPrimaryKey


class UserRule(UUIDPrimaryKey, TimestampMixin, Base):
    """Configurable routing or budget rule."""

    __tablename__ = "user_rules"

    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    rule_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    value: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)

    def __repr__(self) -> str:
        return f"<UserRule id={self.id!r} name={self.name!r} type={self.rule_type!r}>"
