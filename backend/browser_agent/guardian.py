"""
backend.browser_agent.guardian — Safety evaluation for browser and PowerShell actions.
"""

from __future__ import annotations

import re

from backend.browser_agent.models import (
    BrowserAction,
    BrowserActionKind,
    GuardianActionDecision,
    GuardianDecisionType,
    GuardianEvaluationRequest,
    GuardianEvaluationResponse,
)

READ_ONLY_POWERSHELL_PATTERN = re.compile(
    r"^\s*(get-|select-|where-|measure-|test-|resolve-|compare-|find-|write-output|out-string)\b",
    re.IGNORECASE,
)
APPROVAL_POWERSHELL_PATTERNS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\b(remove-item|del|erase|rename-item|move-item|copy-item|new-item|set-content|add-content|clear-content)\b",
        r"\b(stop-process|restart-computer|stop-computer|shutdown|format-volume|clear-disk|diskpart|bcdedit)\b",
        r"\b(remove-appxpackage|unregister-scheduledtask|schtasks\s+/delete|reg\s+delete)\b",
    )
)
DENY_POWERSHELL_PATTERNS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\binvoke-expression\b",
        r"\biex\b",
        r"(invoke-webrequest|curl|wget).*\|",
        r"\bpowershell(\.exe)?\s+-enc",
    )
)
IRREVERSIBLE_BROWSER_HINTS = (
    "submit",
    "send",
    "purchase",
    "pay",
    "checkout",
    "place order",
    "delete",
    "remove",
    "confirm",
    "book",
    "transfer",
    "sign",
    "accept",
)


class BrowserGuardianPolicy:
    """Evaluates whether a proposed action is safe to execute automatically."""

    def evaluate(self, request: GuardianEvaluationRequest) -> GuardianEvaluationResponse:
        decisions: list[GuardianActionDecision] = []
        overall = GuardianDecisionType.ALLOW
        requires_human_approval = False
        has_denials = False

        for action_index, action in enumerate(request.actions):
            decision = self._evaluate_action(action_index=action_index, action=action)
            decisions.append(decision)
            if decision.decision == GuardianDecisionType.DENY:
                overall = GuardianDecisionType.DENY
                has_denials = True
            elif decision.decision == GuardianDecisionType.REQUIRE_APPROVAL and overall != GuardianDecisionType.DENY:
                overall = GuardianDecisionType.REQUIRE_APPROVAL
                requires_human_approval = True

        return GuardianEvaluationResponse(
            overall_decision=overall,
            decisions=decisions,
            requires_human_approval=requires_human_approval,
            has_denials=has_denials,
        )

    def _evaluate_action(self, *, action_index: int, action: BrowserAction) -> GuardianActionDecision:
        if action.kind == BrowserActionKind.POWERSHELL_COMMAND:
            decision, reasons = self._evaluate_powershell(action)
        else:
            decision, reasons = self._evaluate_browser_action(action)
        return GuardianActionDecision(
            action_index=action_index,
            action=action,
            decision=decision,
            reasons=reasons,
        )

    def _evaluate_powershell(self, action: BrowserAction) -> tuple[GuardianDecisionType, list[str]]:
        command = " ".join((action.command or "").split())
        if any(pattern.search(command) for pattern in DENY_POWERSHELL_PATTERNS):
            return (
                GuardianDecisionType.DENY,
                ["PowerShell command matches a blocked download-and-execute or encoded execution pattern."],
            )
        if any(pattern.search(command) for pattern in APPROVAL_POWERSHELL_PATTERNS):
            return (
                GuardianDecisionType.REQUIRE_APPROVAL,
                ["PowerShell command can mutate the system or user data and needs explicit approval."],
            )
        if READ_ONLY_POWERSHELL_PATTERN.search(command):
            return (
                GuardianDecisionType.ALLOW,
                ["PowerShell command appears read-only under the current guardian policy."],
            )
        return (
            GuardianDecisionType.REQUIRE_APPROVAL,
            ["PowerShell command is not clearly read-only, so explicit approval is required."],
        )

    def _evaluate_browser_action(self, action: BrowserAction) -> tuple[GuardianDecisionType, list[str]]:
        if action.irreversible:
            return (
                GuardianDecisionType.REQUIRE_APPROVAL,
                ["Action is explicitly marked as irreversible and needs human approval."],
            )

        action_text = " ".join(
            part
            for part in [action.selector or "", action.text or "", action.url or "", action.rationale or ""]
            if part
        ).lower()
        if any(hint in action_text for hint in IRREVERSIBLE_BROWSER_HINTS):
            return (
                GuardianDecisionType.REQUIRE_APPROVAL,
                ["Action appears to submit, purchase, delete, confirm, or trigger another irreversible side effect."],
            )
        return (
            GuardianDecisionType.ALLOW,
            ["Browser action is reversible or observational under the current guardian policy."],
        )


guardian_policy = BrowserGuardianPolicy()
