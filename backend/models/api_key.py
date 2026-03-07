"""
backend.models.api_key — API key ORM model.

TODO: add per-key rate limit columns.
TODO: add FK to a future `teams` / `users` table.
"""

from __future__ import annotations

from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import Base, TimestampMixin, UUIDPrimaryKey


class APIKey(UUIDPrimaryKey, TimestampMixin, Base):
    """Stores hashed API keys issued to clients."""

    __tablename__ = "api_keys"

    name: Mapped[str] = mapped_column(String(128), nullable=False)
    hashed_key: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    def __repr__(self) -> str:
        return f"<APIKey id={self.id!r} name={self.name!r} active={self.is_active}>"
