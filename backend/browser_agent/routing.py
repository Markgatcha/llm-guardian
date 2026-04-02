"""
backend.browser_agent.routing — Complexity scoring for local vs. remote browser-agent work.
"""

from __future__ import annotations

from backend.browser_agent.models import BrowserTaskProfile, ModelRouteDecision, RoutingTier, SideEffectRisk
from backend.utils.settings import settings


class BrowserTaskRouter:
    """Routes browser-agent work to the cheapest capable tier."""

    REMOTE_THRESHOLD = 7

    def _score(self, task: BrowserTaskProfile) -> tuple[int, list[str]]:
        score = task.estimated_steps
        reasons = [f"Task estimates {task.estimated_steps} browser step(s)."]

        if task.requires_dom:
            score += 1
            reasons.append("DOM inspection is required.")
        if task.requires_visual:
            score += 2
            reasons.append("Visual verification is required.")
        if task.requires_planning:
            score += 2
            reasons.append("Multi-step planning is required.")
        if task.allows_parallel_tabs:
            score += 1
            reasons.append("Independent tabs can be processed in parallel.")
        if task.side_effect_risk == SideEffectRisk.MEDIUM:
            score += 2
            reasons.append("Medium side-effect risk needs extra validation.")
        if task.side_effect_risk == SideEffectRisk.HIGH:
            score += 4
            reasons.append("High side-effect risk needs stronger reasoning and guardrails.")
        if task.completion_checks:
            score += 1
            reasons.append("Explicit completion checks must be verified.")
        if len(task.completion_checks) >= 3:
            score += 1
            reasons.append("Several completion checks are present.")
        if task.requires_windows_computer_use:
            score += 4
            reasons.append("Native Windows computer-use control is required.")

        return score, reasons

    def route(self, task: BrowserTaskProfile) -> ModelRouteDecision:
        score, reasons = self._score(task)
        parallel_tool_calls = task.allows_parallel_tabs and task.estimated_steps > 1

        if task.requires_windows_computer_use:
            reasons.append("Route escalated to GPT-5.4 computer use for native Windows interaction.")
            return ModelRouteDecision(
                tier=RoutingTier.COMPUTER_USE,
                provider="openai",
                model=settings.browser_cua_model,
                complexity_score=score,
                reasons=reasons,
                parallel_tool_calls=False,
                uses_computer_use=True,
            )

        if score >= self.REMOTE_THRESHOLD or task.requires_visual or task.side_effect_risk == SideEffectRisk.HIGH:
            reasons.append("Route escalated to a remote reasoner because the task exceeds the local threshold.")
            return ModelRouteDecision(
                tier=RoutingTier.REMOTE,
                provider=settings.browser_remote_provider,
                model=settings.browser_remote_model,
                complexity_score=score,
                reasons=reasons,
                parallel_tool_calls=parallel_tool_calls,
                uses_computer_use=False,
            )

        reasons.append("Route kept local for fast DOM parsing, heuristics, or lightweight summarization.")
        return ModelRouteDecision(
            tier=RoutingTier.LOCAL,
            provider=settings.browser_local_provider,
            model=settings.browser_local_model,
            complexity_score=score,
            reasons=reasons,
            parallel_tool_calls=parallel_tool_calls,
            uses_computer_use=False,
        )


browser_task_router = BrowserTaskRouter()
