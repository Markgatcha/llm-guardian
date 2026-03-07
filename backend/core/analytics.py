"""
backend.core.analytics — Request telemetry collection and aggregation.

Responsibilities:
- Record per-request metrics (latency, tokens, cost, model, status).
- Aggregate metrics into time-bucketed summaries for the dashboard.
- Expose real-time streaming stats via Redis Streams (future).

TODO: implement time-bucketed aggregation (minute / hour / day).
TODO: push live events onto a Redis Stream for SSE fan-out to the dashboard.
TODO: add p50/p95/p99 latency percentile computation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class RequestEvent:
    """Immutable record of a single LLM request lifecycle."""

    request_id: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    latency_ms: float
    status: str                    # "ok" | "error" | "cached" | "blocked"
    error_code: str | None = None
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


class AnalyticsCollector:
    """
    In-process analytics buffer.

    Accumulates :class:`RequestEvent` objects until they are flushed to the
    database by the background writer task.

    TODO: replace the in-memory buffer with a Redis Stream producer so events
    survive restarts and can be consumed by multiple workers.
    """

    def __init__(self) -> None:
        self._buffer: list[RequestEvent] = []

    def record(self, event: RequestEvent) -> None:
        """Append an event to the in-memory buffer (thread-safe in asyncio)."""
        self._buffer.append(event)

    def flush(self) -> list[RequestEvent]:
        """Drain and return all buffered events, clearing the buffer."""
        events, self._buffer = self._buffer, []
        return events

    def summary(self) -> dict:
        """Return a lightweight in-memory summary for the /stats endpoint."""
        total = len(self._buffer)
        if total == 0:
            return {"total_requests": 0, "total_cost_usd": 0.0, "avg_latency_ms": 0.0}
        cost = sum(e.cost_usd for e in self._buffer)
        latency = sum(e.latency_ms for e in self._buffer) / total
        return {
            "total_requests": total,
            "total_cost_usd": round(cost, 6),
            "avg_latency_ms": round(latency, 2),
        }


# Module-level singleton — shared across all request handlers.
analytics_collector = AnalyticsCollector()
