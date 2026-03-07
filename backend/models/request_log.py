"""
backend.models.request_log — Persisted LLM request event log.

TODO: add index on (timestamp, model) for efficient dashboard queries.
TODO: add FK to api_keys once key auth is implemented.
"""

from __future__ import annotations

from sqlalchemy import Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import Base, TimestampMixin, UUIDPrimaryKey


class RequestLog(UUIDPrimaryKey, TimestampMixin, Base):
    """One row per LLM request proxied through the gateway."""

    __tablename__ = "request_logs"

    model: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    latency_ms: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ok", index=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)

    def __repr__(self) -> str:
        return (
            f"<RequestLog id={self.id!r} model={self.model!r} "
            f"status={self.status!r} cost={self.cost_usd}>"
        )
