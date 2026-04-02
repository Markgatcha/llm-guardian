"""
backend.browser_agent.harness — Python bridge for the JavaScript Playwright harness.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from backend.browser_agent.models import BrowserActionKind, HarnessExecutionRequest, HarnessExecutionResult
from backend.utils.settings import settings

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class PlaywrightHarness:
    """Executes Playwright browser actions through a JavaScript subprocess."""

    def __init__(
        self,
        *,
        node_executable: str | None = None,
        script_path: Path | None = None,
    ) -> None:
        self._node_executable = node_executable or settings.browser_node_executable
        self._script_path = script_path or (PROJECT_ROOT / settings.browser_harness_script)

    def build_command(self) -> list[str]:
        return [self._node_executable, str(self._script_path)]

    async def execute(self, request: HarnessExecutionRequest) -> HarnessExecutionResult:
        if any(action.kind == BrowserActionKind.POWERSHELL_COMMAND for action in request.actions):
            raise ValueError("PowerShell actions must not be executed by the Playwright harness.")
        if not self._script_path.exists():
            raise FileNotFoundError(
                f"Playwright harness script was not found at '{self._script_path}'."
            )

        process = await asyncio.create_subprocess_exec(
            *self.build_command(),
            cwd=str(PROJECT_ROOT),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdin_payload = json.dumps(request.model_dump(mode="json")).encode("utf-8")

        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(stdin_payload),
                timeout=(request.timeout_ms / 1_000) + 2,
            )
        except TimeoutError as exc:
            process.kill()
            await process.wait()
            raise TimeoutError("Playwright harness execution timed out.") from exc

        if process.returncode != 0:
            error_text = stderr.decode("utf-8").strip() or stdout.decode("utf-8").strip()
            raise RuntimeError(f"Playwright harness failed: {error_text}")

        stdout_text = stdout.decode("utf-8").strip()
        if not stdout_text:
            raise RuntimeError("Playwright harness produced no output.")
        return HarnessExecutionResult.model_validate_json(stdout_text)
