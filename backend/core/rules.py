"""
backend.core.rules — Apply persisted routing rules to model candidates.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from backend.models.rules import UserRule


@dataclass(slots=True)
class ModelCandidate:
    model: str
    provider: str
    estimated_cost_usd: float
    p95_latency_ms: float
    supports_vision: bool
    supports_streaming: bool
    context_window: int
    max_output_tokens: int


def _extract_value(value: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in value:
            return value[key]
    return default


def apply_rules(candidates: list[ModelCandidate], rules: list[UserRule]) -> list[ModelCandidate]:
    filtered = list(candidates)
    active_rules = sorted(
        [rule for rule in rules if rule.is_active],
        key=lambda rule: rule.priority,
        reverse=True,
    )

    for rule in active_rules:
        value = rule.value if isinstance(rule.value, dict) else {"value": rule.value}
        if rule.rule_type in {"budget_cap", "max_request_spend"}:
            threshold = float(_extract_value(value, "amount", "usd", "value", default=0.0))
            filtered = [candidate for candidate in filtered if candidate.estimated_cost_usd <= threshold]
        elif rule.rule_type == "provider_pin":
            pinned_provider = str(_extract_value(value, "provider", "value", default=""))
            pinned = [candidate for candidate in filtered if candidate.provider == pinned_provider]
            if pinned:
                filtered = pinned
        elif rule.rule_type == "preferred_provider":
            preferred_provider = str(_extract_value(value, "provider", "value", default=""))
            filtered = sorted(
                filtered,
                key=lambda candidate: (candidate.provider != preferred_provider, candidate.estimated_cost_usd),
            )
        elif rule.rule_type == "preferred_model":
            preferred_model = str(_extract_value(value, "model", "value", default=""))
            filtered = sorted(
                filtered,
                key=lambda candidate: (candidate.model != preferred_model, candidate.estimated_cost_usd),
            )
        elif rule.rule_type == "max_tokens":
            required_tokens = int(_extract_value(value, "max_tokens", "value", default=0))
            filtered = [
                candidate for candidate in filtered if candidate.max_output_tokens >= required_tokens
            ]
    return filtered
