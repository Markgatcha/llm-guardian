"""
backend.browser_agent.cua — Builders for GPT-5.4 Responses API computer-use payloads.
"""

from __future__ import annotations

from typing import Any

from backend.browser_agent.models import ComputerUseRequest
from backend.utils.settings import settings

DEFAULT_DEVELOPER_INSTRUCTIONS = (
    "You are controlling a Windows browser workflow. Build, run, verify, and fix until the explicit "
    "completion rules are satisfied. Do not treat empty DOM captures or narrow page reads as success. "
    "Pause for human approval before irreversible actions."
)


class ResponsesComputerUseBuilder:
    """Builds Windows-native Responses API payloads for GPT-5.4 computer use."""

    def build_request(self, request: ComputerUseRequest) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": settings.browser_cua_model,
            "instructions": request.developer_instructions or DEFAULT_DEVELOPER_INSTRUCTIONS,
            "tools": [
                {
                    "type": "computer_use_preview",
                    "environment": request.environment.environment,
                    "display_width": request.environment.display_width,
                    "display_height": request.environment.display_height,
                }
            ],
            "parallel_tool_calls": request.parallel_tool_calls,
            "max_output_tokens": request.max_output_tokens,
            "store": False,
            "truncation": "auto",
        }
        if request.metadata:
            payload["metadata"] = request.metadata

        if request.previous_response_id:
            payload["previous_response_id"] = request.previous_response_id
            payload["input"] = [self._build_computer_output(request)]
        else:
            payload["input"] = request.goal

        return payload

    def _build_computer_output(self, request: ComputerUseRequest) -> dict[str, Any]:
        if request.call_id is None or request.screenshot_url is None:
            raise ValueError("Follow-up computer-use payloads require `call_id` and `screenshot_url`.")

        output_item: dict[str, Any] = {
            "type": "computer_call_output",
            "call_id": request.call_id,
            "output": {
                "type": "computer_screenshot",
                "image_url": request.screenshot_url,
            },
        }
        if request.acknowledged_safety_checks:
            output_item["acknowledged_safety_checks"] = [
                item.model_dump(mode="json") for item in request.acknowledged_safety_checks
            ]
        return output_item


computer_use_builder = ResponsesComputerUseBuilder()
