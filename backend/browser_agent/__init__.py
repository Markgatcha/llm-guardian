"""
backend.browser_agent — Agentic browser orchestration primitives.
"""

from backend.browser_agent.cua import computer_use_builder
from backend.browser_agent.guardian import guardian_policy
from backend.browser_agent.orchestrator import workflow_orchestrator
from backend.browser_agent.routing import browser_task_router

__all__ = [
    "browser_task_router",
    "computer_use_builder",
    "guardian_policy",
    "workflow_orchestrator",
]
