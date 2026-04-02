"""
backend.browser_agent.models — Structured contracts for the agentic browser slice.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RoutingTier(StrEnum):
    LOCAL = "local"
    REMOTE = "remote"
    COMPUTER_USE = "computer_use"


class SideEffectRisk(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class GuardianDecisionType(StrEnum):
    ALLOW = "allow"
    REQUIRE_APPROVAL = "require_approval"
    DENY = "deny"


class WorkflowStatus(StrEnum):
    SUCCEEDED = "succeeded"
    NEEDS_FIX = "needs_fix"
    BLOCKED = "blocked"
    FAILED = "failed"


class BrowserActionKind(StrEnum):
    GOTO = "goto"
    CLICK = "click"
    FILL = "fill"
    PRESS = "press"
    WAIT_FOR_SELECTOR = "wait_for_selector"
    SCREENSHOT = "screenshot"
    DOM_SNAPSHOT = "dom_snapshot"
    POWERSHELL_COMMAND = "powershell_command"


class BrowserTaskProfile(StrictModel):
    goal: str = Field(min_length=1, max_length=2_000)
    estimated_steps: int = Field(default=1, ge=1, le=25)
    requires_dom: bool = True
    requires_visual: bool = False
    requires_planning: bool = True
    allows_parallel_tabs: bool = False
    side_effect_risk: SideEffectRisk = SideEffectRisk.LOW
    completion_checks: list[str] = Field(default_factory=list)
    requires_windows_computer_use: bool = False


class ModelRouteDecision(StrictModel):
    tier: RoutingTier
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    complexity_score: int = Field(ge=0)
    reasons: list[str] = Field(default_factory=list)
    parallel_tool_calls: bool = False
    uses_computer_use: bool = False


class BrowserAction(StrictModel):
    kind: BrowserActionKind
    selector: str | None = None
    text: str | None = None
    url: str | None = None
    keys: list[str] = Field(default_factory=list)
    command: str | None = None
    rationale: str | None = None
    irreversible: bool = False

    @model_validator(mode="after")
    def validate_shape(self) -> BrowserAction:
        if self.kind == BrowserActionKind.GOTO and not self.url:
            raise ValueError("goto actions require `url`.")
        if self.kind in {BrowserActionKind.CLICK, BrowserActionKind.WAIT_FOR_SELECTOR} and not self.selector:
            raise ValueError(f"{self.kind.value} actions require `selector`.")
        if self.kind == BrowserActionKind.FILL and (not self.selector or self.text is None):
            raise ValueError("fill actions require both `selector` and `text`.")
        if self.kind == BrowserActionKind.PRESS and not self.keys:
            raise ValueError("press actions require `keys`.")
        if self.kind == BrowserActionKind.POWERSHELL_COMMAND and not self.command:
            raise ValueError("powershell_command actions require `command`.")
        return self


class GuardianActionDecision(StrictModel):
    action_index: int = Field(ge=0)
    action: BrowserAction
    decision: GuardianDecisionType
    reasons: list[str] = Field(default_factory=list)


class GuardianEvaluationRequest(StrictModel):
    actions: list[BrowserAction] = Field(min_length=1)


class GuardianEvaluationResponse(StrictModel):
    overall_decision: GuardianDecisionType
    decisions: list[GuardianActionDecision] = Field(default_factory=list)
    requires_human_approval: bool = False
    has_denials: bool = False


class BrowserObservation(StrictModel):
    url: str | None = None
    title: str | None = None
    dom_excerpt: str = ""
    visible_text: str = ""
    elements: list[str] = Field(default_factory=list)
    screenshot_path: str | None = None
    screenshot_url: str | None = None

    def combined_text(self) -> str:
        parts = [self.title or "", self.dom_excerpt, self.visible_text, "\n".join(self.elements)]
        return "\n".join(part for part in parts if part.strip())


class VerificationRule(StrictModel):
    required_text: list[str] = Field(default_factory=list)
    forbidden_text: list[str] = Field(default_factory=list)
    required_url_fragments: list[str] = Field(default_factory=list)
    required_elements: list[str] = Field(default_factory=list)
    require_non_empty_dom: bool = True


class WorkflowStep(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    objective: str = Field(min_length=1, max_length=500)
    actions: list[BrowserAction] = Field(default_factory=list)
    fallback_actions: list[BrowserAction] = Field(default_factory=list)
    verification: VerificationRule = Field(default_factory=VerificationRule)
    retry_limit: int = Field(default=1, ge=0, le=5)
    recovery_guidance: str | None = None


class ActionExecutionResult(StrictModel):
    kind: BrowserActionKind
    status: Literal["completed", "failed"]
    detail: str = ""


class HarnessExecutionRequest(StrictModel):
    session_id: str | None = None
    start_url: str | None = None
    browser_name: Literal["chromium", "firefox", "webkit"] = "chromium"
    headless: bool = True
    timeout_ms: int = Field(default=15_000, ge=1_000, le=120_000)
    capture_screenshot: bool = True
    capture_dom: bool = True
    actions: list[BrowserAction] = Field(default_factory=list)


class HarnessExecutionResult(StrictModel):
    session_id: str | None = None
    observation: BrowserObservation = Field(default_factory=BrowserObservation)
    action_results: list[ActionExecutionResult] = Field(default_factory=list)


class BrowserWorkflowRunRequest(StrictModel):
    task: BrowserTaskProfile
    steps: list[WorkflowStep] = Field(min_length=1)
    final_verification: VerificationRule = Field(default_factory=VerificationRule)
    session_id: str | None = None
    start_url: str | None = None
    browser_name: Literal["chromium", "firefox", "webkit"] = "chromium"
    headless: bool = True
    max_fix_attempts: int = Field(default=2, ge=0, le=10)
    recorded_harness_results: list[HarnessExecutionResult] = Field(default_factory=list)


class StepRunResult(StrictModel):
    step_id: str
    attempt: int = Field(ge=0)
    status: WorkflowStatus
    guardian: GuardianEvaluationResponse
    observation: BrowserObservation = Field(default_factory=BrowserObservation)
    action_results: list[ActionExecutionResult] = Field(default_factory=list)
    issues: list[str] = Field(default_factory=list)
    recovery_plan: list[str] = Field(default_factory=list)


class BrowserWorkflowRunResult(StrictModel):
    status: WorkflowStatus
    route: ModelRouteDecision
    completion_satisfied: bool
    completion_summary: str
    step_results: list[StepRunResult] = Field(default_factory=list)
    blocked_action: BrowserAction | None = None
    remaining_fix_attempts: int = Field(ge=0)
    next_fix_prompt: str | None = None


class AcknowledgedSafetyCheck(StrictModel):
    id: str = Field(min_length=1)
    code: str | None = None
    message: str | None = None


class ComputerUseEnvironment(StrictModel):
    display_width: int = Field(default=1_440, ge=640, le=3_840)
    display_height: int = Field(default=900, ge=480, le=2_160)
    environment: Literal["windows", "mac", "linux", "ubuntu", "browser"] = "windows"


class ComputerUseRequest(StrictModel):
    goal: str = Field(min_length=1, max_length=2_000)
    developer_instructions: str | None = None
    environment: ComputerUseEnvironment = Field(default_factory=ComputerUseEnvironment)
    previous_response_id: str | None = None
    call_id: str | None = None
    screenshot_url: str | None = None
    acknowledged_safety_checks: list[AcknowledgedSafetyCheck] = Field(default_factory=list)
    max_output_tokens: int = Field(default=900, ge=100, le=4_000)
    parallel_tool_calls: bool = False
    metadata: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_follow_up_shape(self) -> ComputerUseRequest:
        has_follow_up_fields = self.call_id is not None or self.screenshot_url is not None
        if self.previous_response_id and (not self.call_id or not self.screenshot_url):
            raise ValueError(
                "Follow-up computer-use requests require `previous_response_id`, `call_id`, and `screenshot_url`."
            )
        if has_follow_up_fields and not self.previous_response_id:
            raise ValueError(
                "`call_id` and `screenshot_url` are only valid on follow-up requests with `previous_response_id`."
            )
        return self


class ComputerUsePayloadEnvelope(StrictModel):
    payload: dict[str, Any]
