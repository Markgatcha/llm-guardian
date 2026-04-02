"""
backend.browser_agent.orchestrator — Build-run-verify-fix workflow execution.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from backend.browser_agent.guardian import guardian_policy
from backend.browser_agent.harness import PlaywrightHarness
from backend.browser_agent.models import (
    BrowserAction,
    BrowserObservation,
    BrowserWorkflowRunRequest,
    BrowserWorkflowRunResult,
    GuardianDecisionType,
    GuardianEvaluationRequest,
    GuardianEvaluationResponse,
    HarnessExecutionRequest,
    HarnessExecutionResult,
    StepRunResult,
    VerificationRule,
    WorkflowStatus,
    WorkflowStep,
)
from backend.browser_agent.routing import browser_task_router


class BrowserHarness(Protocol):
    async def execute(self, request: HarnessExecutionRequest) -> HarnessExecutionResult: ...


class ReplayBrowserHarness:
    """Deterministic harness used for tests and dry runs."""

    def __init__(self, results: Sequence[HarnessExecutionResult]) -> None:
        self._results = list(results)
        self._cursor = 0

    async def execute(self, request: HarnessExecutionRequest) -> HarnessExecutionResult:
        if self._cursor >= len(self._results):
            raise RuntimeError("No recorded harness result is available for the requested attempt.")
        result = self._results[self._cursor]
        self._cursor += 1
        return result


class WorkflowOrchestrator:
    """Runs the guarded build-run-verify-fix loop for browser workflows."""

    async def run(self, request: BrowserWorkflowRunRequest) -> BrowserWorkflowRunResult:
        route = browser_task_router.route(request.task)
        harness: BrowserHarness
        if request.recorded_harness_results:
            harness = ReplayBrowserHarness(request.recorded_harness_results)
        else:
            harness = PlaywrightHarness()

        step_results: list[StepRunResult] = []
        remaining_fix_attempts = request.max_fix_attempts
        latest_observation = BrowserObservation()

        for step_index, step in enumerate(request.steps):
            status, remaining_fix_attempts, latest_observation, blocked_action, next_fix_prompt = await self._run_step(
                harness=harness,
                request=request,
                step=step,
                step_index=step_index,
                step_results=step_results,
                remaining_fix_attempts=remaining_fix_attempts,
            )
            if status != WorkflowStatus.SUCCEEDED:
                return BrowserWorkflowRunResult(
                    status=status,
                    route=route,
                    completion_satisfied=False,
                    completion_summary=next_fix_prompt or f"Workflow stopped at step '{step.id}'.",
                    step_results=step_results,
                    blocked_action=blocked_action,
                    remaining_fix_attempts=remaining_fix_attempts,
                    next_fix_prompt=next_fix_prompt,
                )

        final_issues = self._verify(step_rule=request.final_verification, observation=latest_observation)
        if final_issues:
            recovery_plan = self._build_recovery_plan(step=None, issues=final_issues)
            return BrowserWorkflowRunResult(
                status=WorkflowStatus.NEEDS_FIX,
                route=route,
                completion_satisfied=False,
                completion_summary="Final completion rules were not satisfied.",
                step_results=step_results,
                blocked_action=None,
                remaining_fix_attempts=remaining_fix_attempts,
                next_fix_prompt=" ".join(recovery_plan),
            )

        return BrowserWorkflowRunResult(
            status=WorkflowStatus.SUCCEEDED,
            route=route,
            completion_satisfied=True,
            completion_summary="All workflow steps and final completion checks passed.",
            step_results=step_results,
            blocked_action=None,
            remaining_fix_attempts=remaining_fix_attempts,
            next_fix_prompt=None,
        )

    async def _run_step(
        self,
        *,
        harness: BrowserHarness,
        request: BrowserWorkflowRunRequest,
        step: WorkflowStep,
        step_index: int,
        step_results: list[StepRunResult],
        remaining_fix_attempts: int,
    ) -> tuple[WorkflowStatus, int, BrowserObservation, BrowserAction | None, str | None]:
        actions_for_attempt = step.actions
        latest_observation = BrowserObservation()

        for attempt in range(1, step.retry_limit + 2):
            guardian = guardian_policy.evaluate(GuardianEvaluationRequest(actions=actions_for_attempt or step.actions))
            blocked_action = self._first_action_for_decision(guardian, GuardianDecisionType.REQUIRE_APPROVAL)
            denied_action = self._first_action_for_decision(guardian, GuardianDecisionType.DENY)

            if guardian.has_denials:
                step_results.append(
                    StepRunResult(
                        step_id=step.id,
                        attempt=attempt,
                        status=WorkflowStatus.FAILED,
                        guardian=guardian,
                        issues=["Guardian denied a proposed action."],
                    )
                )
                return (
                    WorkflowStatus.FAILED,
                    remaining_fix_attempts,
                    latest_observation,
                    denied_action,
                    "Guardian denied a proposed action before execution.",
                )

            if guardian.requires_human_approval:
                step_results.append(
                    StepRunResult(
                        step_id=step.id,
                        attempt=attempt,
                        status=WorkflowStatus.BLOCKED,
                        guardian=guardian,
                        issues=["Human approval is required before this action can run."],
                    )
                )
                return (
                    WorkflowStatus.BLOCKED,
                    remaining_fix_attempts,
                    latest_observation,
                    blocked_action,
                    "Human approval is required before the workflow can continue.",
                )

            harness_request = HarnessExecutionRequest(
                session_id=request.session_id,
                start_url=request.start_url if step_index == 0 and attempt == 1 else None,
                browser_name=request.browser_name,
                headless=request.headless,
                actions=actions_for_attempt,
            )
            harness_result = await harness.execute(harness_request)
            latest_observation = harness_result.observation
            issues = self._verify(step_rule=step.verification, observation=latest_observation)

            if not issues:
                step_results.append(
                    StepRunResult(
                        step_id=step.id,
                        attempt=attempt,
                        status=WorkflowStatus.SUCCEEDED,
                        guardian=guardian,
                        observation=latest_observation,
                        action_results=harness_result.action_results,
                        issues=[],
                        recovery_plan=[],
                    )
                )
                return WorkflowStatus.SUCCEEDED, remaining_fix_attempts, latest_observation, None, None

            recovery_plan = self._build_recovery_plan(step=step, issues=issues)
            step_results.append(
                StepRunResult(
                    step_id=step.id,
                    attempt=attempt,
                    status=WorkflowStatus.NEEDS_FIX,
                    guardian=guardian,
                    observation=latest_observation,
                    action_results=harness_result.action_results,
                    issues=issues,
                    recovery_plan=recovery_plan,
                )
            )

            if attempt > step.retry_limit or remaining_fix_attempts == 0:
                return (
                    WorkflowStatus.NEEDS_FIX,
                    remaining_fix_attempts,
                    latest_observation,
                    None,
                    " ".join(recovery_plan),
                )

            remaining_fix_attempts -= 1
            if step.fallback_actions:
                actions_for_attempt = step.fallback_actions

        return (
            WorkflowStatus.NEEDS_FIX,
            remaining_fix_attempts,
            latest_observation,
            None,
            "Workflow step exhausted its retry budget.",
        )

    def _verify(self, *, step_rule: VerificationRule, observation: BrowserObservation) -> list[str]:
        issues: list[str] = []
        combined_text = observation.combined_text().lower()
        normalized_url = (observation.url or "").lower()
        normalized_elements = {element.lower() for element in observation.elements}

        if step_rule.require_non_empty_dom and not (observation.dom_excerpt.strip() or observation.visible_text.strip()):
            issues.append("DOM capture was empty; request a fresh DOM snapshot and screenshot before proceeding.")

        for required_text in step_rule.required_text:
            if required_text.lower() not in combined_text:
                issues.append(f"Missing required text: {required_text}")

        for forbidden_text in step_rule.forbidden_text:
            if forbidden_text.lower() in combined_text:
                issues.append(f"Forbidden text is still present: {forbidden_text}")

        for fragment in step_rule.required_url_fragments:
            if fragment.lower() not in normalized_url:
                issues.append(f"URL does not contain required fragment: {fragment}")

        for required_element in step_rule.required_elements:
            lowered = required_element.lower()
            if lowered not in normalized_elements and lowered not in combined_text:
                issues.append(f"Missing required element hint: {required_element}")

        return issues

    def _build_recovery_plan(self, *, step: WorkflowStep | None, issues: list[str]) -> list[str]:
        recovery_plan: list[str] = []

        if any("DOM capture was empty" in issue for issue in issues):
            recovery_plan.append("Capture a fresh DOM snapshot and screenshot before trusting the page state.")
        if any(issue.startswith("Missing required text:") for issue in issues):
            recovery_plan.append("Wait for the target UI to settle, then read the DOM again with tighter selectors.")
        if any(issue.startswith("URL does not contain required fragment:") for issue in issues):
            recovery_plan.append("Repeat navigation and verify the browser actually reached the expected route.")
        if any(issue.startswith("Forbidden text is still present:") for issue in issues):
            recovery_plan.append("Inspect the latest page state for error banners before retrying the next action.")
        if step is not None and step.recovery_guidance:
            recovery_plan.append(step.recovery_guidance)
        if not recovery_plan:
            recovery_plan.append("Inspect the latest screenshot and DOM, then adjust the next action before retrying.")

        return recovery_plan

    def _first_action_for_decision(
        self,
        guardian: GuardianEvaluationResponse,
        decision: GuardianDecisionType,
    ) -> BrowserAction | None:
        for action_decision in guardian.decisions:
            if action_decision.decision == decision:
                return action_decision.action
        return None


workflow_orchestrator = WorkflowOrchestrator()
