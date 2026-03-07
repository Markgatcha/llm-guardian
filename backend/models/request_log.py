"""
backend.models.request_log — Persisted LLM request event log.
"""

from __future__ import annotations

from sqlalchemy import Boolean, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import Base, TimestampMixin, UUIDPrimaryKey


class RequestLog(UUIDPrimaryKey, TimestampMixin, Base):
    """One row per LLM request proxied through the gateway."""

    __tablename__ = "request_logs"

    model: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(64), nullable=False, default="unknown", index=True)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    baseline_cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    saved_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    latency_ms: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    cache_hit: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ok", index=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)

    def __repr__(self) -> str:
        return (
            f"<RequestLog id={self.id!r} model={self.model!r} "
            f"provider={self.provider!r} status={self.status!r} cost={self.cost_usd}>"
        )
