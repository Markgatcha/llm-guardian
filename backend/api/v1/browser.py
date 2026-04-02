"""
backend.api.v1.browser — Agentic browser routing, safety, and workflow APIs.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from backend.browser_agent.cua import computer_use_builder
from backend.browser_agent.models import (
    BrowserTaskProfile,
    BrowserWorkflowRunRequest,
    BrowserWorkflowRunResult,
    ComputerUsePayloadEnvelope,
    ComputerUseRequest,
    GuardianEvaluationRequest,
    GuardianEvaluationResponse,
    ModelRouteDecision,
)
from backend.browser_agent.guardian import guardian_policy
from backend.browser_agent.orchestrator import workflow_orchestrator
from backend.browser_agent.routing import browser_task_router
from backend.core.auth import require_admin

router = APIRouter(dependencies=[Depends(require_admin)])


@router.post("/route", response_model=ModelRouteDecision)
async def route_browser_task(payload: BrowserTaskProfile) -> ModelRouteDecision:
    return browser_task_router.route(payload)


@router.post("/guardian/evaluate", response_model=GuardianEvaluationResponse)
async def evaluate_browser_guardian(payload: GuardianEvaluationRequest) -> GuardianEvaluationResponse:
    return guardian_policy.evaluate(payload)


@router.post("/cua/request", response_model=ComputerUsePayloadEnvelope)
async def build_cua_request(payload: ComputerUseRequest) -> ComputerUsePayloadEnvelope:
    return ComputerUsePayloadEnvelope(payload=computer_use_builder.build_request(payload))


@router.post("/workflows/run", response_model=BrowserWorkflowRunResult)
async def run_browser_workflow(payload: BrowserWorkflowRunRequest) -> BrowserWorkflowRunResult:
    try:
        return await workflow_orchestrator.run(payload)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_424_FAILED_DEPENDENCY,
            detail=str(exc),
        ) from exc
