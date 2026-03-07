"""
backend.core.pricing — Token-cost accounting for LLM requests.

Responsibilities:
- Calculate USD cost for a completed LLM call (prompt + completion tokens).
- Persist cost records to the database for budget tracking and reporting.
- Trigger alerts when a configurable daily budget threshold is exceeded.

TODO: load pricing table from config.yaml at startup (not hard-coded).
TODO: implement daily/monthly budget aggregation queries.
TODO: support per-key or per-team budget allocation.
"""

from __future__ import annotations

from dataclasses import dataclass

import structlog

logger = structlog.get_logger(__name__)

# Costs in USD per 1 000 tokens — keep in sync with config.example.yaml.
# TODO: replace with dynamic lookup from config/database.
PRICING_TABLE: dict[str, dict[str, float]] = {
    "gpt-4o":            {"input": 0.005,   "output": 0.015},
    "gpt-4o-mini":       {"input": 0.00015, "output": 0.0006},
    "gpt-4-turbo":       {"input": 0.01,    "output": 0.03},
    "claude-3-5-sonnet": {"input": 0.003,   "output": 0.015},
    "claude-3-haiku":    {"input": 0.00025, "output": 0.00125},
}

# Fallback rate when model is not in the table (err on the side of overestimate).
_DEFAULT_RATE: dict[str, float] = {"input": 0.01, "output": 0.03}


@dataclass
class CostRecord:
    model: str
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


def calculate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> CostRecord:
    """
    Return a :class:`CostRecord` for the given token counts.

    Uses the nearest model match in :data:`PRICING_TABLE`, falling back to a
    conservative default rate for unknown models.
    """
    rates = PRICING_TABLE.get(model)
    if rates is None:
        # Try prefix match (e.g. "gpt-4o-2024-05-13" → "gpt-4o")
        for key, r in PRICING_TABLE.items():
            if model.startswith(key):
                rates = r
                break
        else:
            logger.warning("pricing.unknown_model", model=model)
            rates = _DEFAULT_RATE

    cost = (prompt_tokens * rates["input"] + completion_tokens * rates["output"]) / 1_000
    record = CostRecord(
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cost_usd=round(cost, 8),
    )
    logger.debug("pricing.calculated", **record.__dict__)
    return record
