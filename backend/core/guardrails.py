"""
backend.core.guardrails — Input safety and spend guardrails.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.pricing import pricing_catalog
from backend.models.request_log import RequestLog
from backend.utils.settings import settings

logger = structlog.get_logger(__name__)

_PII_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
    re.compile(r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"),
    re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
]

_INJECTION_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"ignore\s+(all\s+)?previous\s+instructions", re.IGNORECASE),
    re.compile(r"you\s+are\s+now\s+(?:a|an)\s+", re.IGNORECASE),
    re.compile(r"disregard\s+(?:all\s+)?(?:prior|previous)", re.IGNORECASE),
]


class ViolationType(StrEnum):
    PII = "pii"
    PROMPT_INJECTION = "prompt_injection"
    TOKEN_BUDGET = "token_budget"
    REQUEST_COST = "request_cost"
    DAILY_BUDGET = "daily_budget"
    MONTHLY_BUDGET = "monthly_budget"
    EXPENSIVE_CONFIRMATION = "expensive_confirmation"


@dataclass
class GuardrailResult:
    allowed: bool = True
    violations: list[ViolationType] = field(default_factory=list)
    message: str = ""


class GuardrailsEngine:
    """Stateless rule-based guardrails engine."""

    def __init__(
        self,
        block_pii: bool = True,
        block_prompt_injection: bool = True,
        max_prompt_tokens: int = 4096,
        max_request_cost_usd: float | None = None,
        daily_budget_usd: float | None = None,
        monthly_budget_usd: float | None = None,
        expensive_model_threshold_usd: float | None = None,
    ) -> None:
        self.block_pii = block_pii
        self.block_prompt_injection = block_prompt_injection
        self.max_prompt_tokens = max_prompt_tokens
        self.max_request_cost_usd = (
            settings.max_request_cost_usd if max_request_cost_usd is None else max_request_cost_usd
        )
        self.daily_budget_usd = settings.daily_budget_usd if daily_budget_usd is None else daily_budget_usd
        self.monthly_budget_usd = (
            settings.monthly_budget_usd if monthly_budget_usd is None else monthly_budget_usd
        )
        self.expensive_model_threshold_usd = (
            settings.expensive_model_threshold_usd
            if expensive_model_threshold_usd is None
            else expensive_model_threshold_usd
        )

    def check_input(self, messages: list[dict[str, Any]]) -> GuardrailResult:
        result = GuardrailResult()
        full_text = " ".join(
            str(message.get("content", ""))
            for message in messages
            if isinstance(message, dict) and not isinstance(message.get("content"), list)
        )

        if self.block_pii:
            for pattern in _PII_PATTERNS:
                if pattern.search(full_text):
                    result.violations.append(ViolationType.PII)
                    logger.warning("guardrails.pii_detected")
                    break

        if self.block_prompt_injection:
            for pattern in _INJECTION_PATTERNS:
                if pattern.search(full_text):
                    result.violations.append(ViolationType.PROMPT_INJECTION)
                    logger.warning("guardrails.injection_detected")
                    break

        estimated_tokens = max(1, len(full_text) // 4) if full_text else 0
        if estimated_tokens > self.max_prompt_tokens:
            result.violations.append(ViolationType.TOKEN_BUDGET)
            logger.warning("guardrails.token_budget_exceeded", estimated=estimated_tokens)

        if result.violations:
            result.allowed = False
            result.message = f"Request blocked by guardrails: {[violation.value for violation in result.violations]}"
        return result

    def estimate_cost(
        self,
        model: str,
        messages: list[dict[str, Any]],
        completion_tokens: int = 0,
    ) -> float:
        return pricing_catalog.estimate_cost_for_messages(model, messages, completion_tokens)

    def check_confirmation(self, estimated_cost: float, confirmed: bool = False) -> GuardrailResult:
        if estimated_cost <= self.expensive_model_threshold_usd or confirmed:
            return GuardrailResult()
        return GuardrailResult(
            allowed=False,
            violations=[ViolationType.EXPENSIVE_CONFIRMATION],
            message="Request exceeds the expensive-model threshold and requires confirmation.",
        )

    async def _sum_cost_between(
        self,
        session: AsyncSession,
        start_at: datetime,
        end_at: datetime,
    ) -> float:
        total = await session.scalar(
            select(func.coalesce(func.sum(RequestLog.cost_usd), 0.0)).where(
                RequestLog.created_at >= start_at,
                RequestLog.created_at < end_at,
            )
        )
        return float(total or 0.0)

    async def check_budget(self, estimated_cost: float, session: AsyncSession) -> GuardrailResult:
        if estimated_cost > self.max_request_cost_usd:
            return GuardrailResult(
                allowed=False,
                violations=[ViolationType.REQUEST_COST],
                message="Request exceeds the per-request cost limit.",
            )

        now = datetime.now(UTC)
        day_start = datetime(now.year, now.month, now.day, tzinfo=UTC)
        month_start = datetime(now.year, now.month, 1, tzinfo=UTC)
        next_day = day_start + timedelta(days=1)
        if now.month == 12:
            next_month = datetime(now.year + 1, 1, 1, tzinfo=UTC)
        else:
            next_month = datetime(now.year, now.month + 1, 1, tzinfo=UTC)

        daily_spend = await self._sum_cost_between(session, day_start, next_day)
        if daily_spend + estimated_cost > self.daily_budget_usd:
            return GuardrailResult(
                allowed=False,
                violations=[ViolationType.DAILY_BUDGET],
                message="Daily budget would be exceeded by this request.",
            )

        monthly_spend = await self._sum_cost_between(session, month_start, next_month)
        if monthly_spend + estimated_cost > self.monthly_budget_usd:
            return GuardrailResult(
                allowed=False,
                violations=[ViolationType.MONTHLY_BUDGET],
                message="Monthly budget would be exceeded by this request.",
            )

        return GuardrailResult()


guardrails_engine = GuardrailsEngine()
