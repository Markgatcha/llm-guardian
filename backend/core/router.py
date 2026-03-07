"""
backend.core.router — LLM provider routing via LiteLLM.

Responsibilities:
- Select the optimal provider / model for an incoming request.
- Handle fallback chains when a provider is unavailable.
- Enforce per-request timeout and retry budgets.
- Forward streaming and non-streaming responses unchanged.

TODO: implement provider health-checks and latency-weighted routing.
"""

from __future__ import annotations

import structlog
from litellm import acompletion

logger = structlog.get_logger(__name__)


class LLMRouter:
    """Thin async wrapper around LiteLLM with fallback support."""

    def __init__(self, fallback_chain: list[str] | None = None) -> None:
        self.fallback_chain: list[str] = fallback_chain or ["openai", "anthropic"]

    async def complete(
        self,
        model: str,
        messages: list[dict],
        **kwargs,
    ) -> dict:
        """
        Send a chat-completion request, retrying through the fallback chain on error.

        Args:
            model: LiteLLM model string, e.g. ``"gpt-4o"`` or ``"claude-3-5-sonnet"``.
            messages: OpenAI-style message list.
            **kwargs: Extra LiteLLM kwargs (temperature, max_tokens, stream, …).

        Returns:
            LiteLLM ModelResponse as a dict.

        TODO: implement actual fallback iteration and structured error mapping.
        """
        logger.info("router.complete", model=model, n_messages=len(messages))
        response = await acompletion(model=model, messages=messages, **kwargs)
        return response  # type: ignore[return-value]


# Module-level singleton initialised during app startup.
lifespan_router = LLMRouter()
