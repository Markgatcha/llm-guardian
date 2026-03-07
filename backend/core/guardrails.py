"""
backend.core.guardrails — Input/output safety layer.

Responsibilities:
- Block or flag prompts containing PII (names, email, phone, SSN).
- Detect and reject prompt-injection attempts.
- Enforce token-budget limits before forwarding to the LLM.
- Post-process LLM output to redact or warn on sensitive content.

TODO: integrate a proper PII detection library (e.g. Presidio).
TODO: add configurable rule engine for custom guardrail policies.
TODO: implement output guardrails (hate, self-harm, CSAM classifiers).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum

import structlog

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Simple heuristic patterns (replace with Presidio or similar in production)
# ---------------------------------------------------------------------------
_PII_PATTERNS: list[re.Pattern] = [
    re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),  # email
    re.compile(r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"),     # phone (US)
    re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),                                          # SSN
]

_INJECTION_PATTERNS: list[re.Pattern] = [
    re.compile(r"ignore\s+(all\s+)?previous\s+instructions", re.IGNORECASE),
    re.compile(r"you\s+are\s+now\s+(?:a|an)\s+", re.IGNORECASE),
    re.compile(r"disregard\s+(?:all\s+)?(?:prior|previous)", re.IGNORECASE),
]


class ViolationType(str, Enum):
    PII = "pii"
    PROMPT_INJECTION = "prompt_injection"
    TOKEN_BUDGET = "token_budget"


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
    ) -> None:
        self.block_pii = block_pii
        self.block_prompt_injection = block_prompt_injection
        self.max_prompt_tokens = max_prompt_tokens

    def check_input(self, messages: list[dict]) -> GuardrailResult:
        """
        Evaluate a list of chat messages against all enabled guardrail policies.

        Returns a :class:`GuardrailResult` describing whether the request is
        allowed and which, if any, policies were violated.
        """
        result = GuardrailResult()
        full_text = " ".join(m.get("content", "") for m in messages if isinstance(m.get("content"), str))

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

        # Rough token estimate: 1 token ≈ 4 chars
        estimated_tokens = len(full_text) // 4
        if estimated_tokens > self.max_prompt_tokens:
            result.violations.append(ViolationType.TOKEN_BUDGET)
            logger.warning("guardrails.token_budget_exceeded", estimated=estimated_tokens)

        if result.violations:
            result.allowed = False
            result.message = f"Request blocked by guardrails: {[v.value for v in result.violations]}"

        return result


# Module-level singleton with defaults (override via settings at startup).
guardrails_engine = GuardrailsEngine()
