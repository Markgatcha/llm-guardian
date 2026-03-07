"""
backend.core.pricing — Pricing catalog, cost calculation, and savings helpers.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import httpx
import structlog

from backend.utils.settings import settings

logger = structlog.get_logger(__name__)


@dataclass(slots=True)
class PricingEntry:
    model: str
    provider: str
    input_cost_per_1k: float
    output_cost_per_1k: float
    context_window: int
    max_output_tokens: int
    supports_vision: bool = False
    supports_streaming: bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class CostRecord:
    model: str
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


DEFAULT_CATALOG: dict[str, PricingEntry] = {
    "gpt-4o": PricingEntry(
        model="gpt-4o",
        provider="openai",
        input_cost_per_1k=0.005,
        output_cost_per_1k=0.015,
        context_window=128000,
        max_output_tokens=16384,
        supports_vision=True,
    ),
    "gpt-4o-mini": PricingEntry(
        model="gpt-4o-mini",
        provider="openai",
        input_cost_per_1k=0.00015,
        output_cost_per_1k=0.0006,
        context_window=128000,
        max_output_tokens=16384,
        supports_vision=True,
    ),
    "gpt-4.1-mini": PricingEntry(
        model="gpt-4.1-mini",
        provider="openai",
        input_cost_per_1k=0.0004,
        output_cost_per_1k=0.0016,
        context_window=128000,
        max_output_tokens=16384,
        supports_vision=True,
    ),
    "azure/gpt-4o-mini": PricingEntry(
        model="azure/gpt-4o-mini",
        provider="azure-openai",
        input_cost_per_1k=0.00018,
        output_cost_per_1k=0.00065,
        context_window=128000,
        max_output_tokens=16384,
        supports_vision=True,
    ),
    "claude-3-5-sonnet": PricingEntry(
        model="claude-3-5-sonnet",
        provider="anthropic",
        input_cost_per_1k=0.003,
        output_cost_per_1k=0.015,
        context_window=200000,
        max_output_tokens=8192,
        supports_vision=True,
    ),
    "claude-3-haiku": PricingEntry(
        model="claude-3-haiku",
        provider="anthropic",
        input_cost_per_1k=0.00025,
        output_cost_per_1k=0.00125,
        context_window=200000,
        max_output_tokens=4096,
        supports_vision=True,
    ),
    "groq/llama-3.1-8b-instant": PricingEntry(
        model="groq/llama-3.1-8b-instant",
        provider="groq",
        input_cost_per_1k=0.0004,
        output_cost_per_1k=0.00085,
        context_window=131072,
        max_output_tokens=8192,
    ),
    "groq/llama-3.3-70b-versatile": PricingEntry(
        model="groq/llama-3.3-70b-versatile",
        provider="groq",
        input_cost_per_1k=0.00059,
        output_cost_per_1k=0.00079,
        context_window=131072,
        max_output_tokens=8192,
    ),
    "vertex_ai/gemini-1.5-flash": PricingEntry(
        model="vertex_ai/gemini-1.5-flash",
        provider="google-vertex",
        input_cost_per_1k=0.00035,
        output_cost_per_1k=0.00105,
        context_window=1000000,
        max_output_tokens=8192,
        supports_vision=True,
    ),
    "vertex_ai/gemini-1.5-pro": PricingEntry(
        model="vertex_ai/gemini-1.5-pro",
        provider="google-vertex",
        input_cost_per_1k=0.00125,
        output_cost_per_1k=0.005,
        context_window=1000000,
        max_output_tokens=8192,
        supports_vision=True,
    ),
    "ollama/llama3.2": PricingEntry(
        model="ollama/llama3.2",
        provider="ollama",
        input_cost_per_1k=0.0012,
        output_cost_per_1k=0.0012,
        context_window=32768,
        max_output_tokens=4096,
    ),
    "mistral-small-latest": PricingEntry(
        model="mistral-small-latest",
        provider="mistral",
        input_cost_per_1k=0.0002,
        output_cost_per_1k=0.0006,
        context_window=32000,
        max_output_tokens=8192,
    ),
    "command-r-plus": PricingEntry(
        model="command-r-plus",
        provider="cohere",
        input_cost_per_1k=0.003,
        output_cost_per_1k=0.015,
        context_window=128000,
        max_output_tokens=4096,
    ),
}

PRICING_TABLE: dict[str, dict[str, float]] = {
    entry.model: {"input": entry.input_cost_per_1k, "output": entry.output_cost_per_1k}
    for entry in DEFAULT_CATALOG.values()
}

_DEFAULT_RATE: dict[str, float] = {"input": 0.01, "output": 0.03}


def flatten_messages(messages: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for message in messages:
        content = message.get("content", "")
        if isinstance(content, str):
            parts.append(content)
            continue
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict):
                    if item.get("type") == "text":
                        parts.append(str(item.get("text", "")))
                    elif item.get("type") == "image_url":
                        parts.append("[image]")
                else:
                    parts.append(str(item))
            continue
        parts.append(str(content))
    return " ".join(part for part in parts if part).strip()


def estimate_prompt_tokens(messages: list[dict[str, Any]]) -> int:
    flattened = flatten_messages(messages)
    return max(1, len(flattened) // 4) if flattened else 1


class PricingCatalog:
    def __init__(self) -> None:
        self._entries: dict[str, PricingEntry] = dict(DEFAULT_CATALOG)

    def reset(self) -> None:
        self._entries = dict(DEFAULT_CATALOG)

    @property
    def entries(self) -> dict[str, PricingEntry]:
        return self._entries

    def resolve_model(self, model: str) -> PricingEntry | None:
        direct = self._entries.get(model)
        if direct is not None:
            return direct
        for name, entry in self._entries.items():
            if model.startswith(name):
                return entry
        return None

    def get_provider(self, model: str) -> str:
        entry = self.resolve_model(model)
        return entry.provider if entry is not None else "unknown"

    def calculate_cost(self, model: str, prompt_tokens: int, completion_tokens: int) -> CostRecord:
        entry = self.resolve_model(model)
        if entry is None:
            logger.warning("pricing.unknown_model", model=model)
            rates = _DEFAULT_RATE
        else:
            rates = {"input": entry.input_cost_per_1k, "output": entry.output_cost_per_1k}

        cost = (prompt_tokens * rates["input"] + completion_tokens * rates["output"]) / 1_000
        return CostRecord(
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_usd=round(cost, 8),
        )

    def estimate_cost_for_messages(
        self,
        model: str,
        messages: list[dict[str, Any]],
        completion_tokens: int = 0,
    ) -> float:
        prompt_tokens = estimate_prompt_tokens(messages)
        return self.calculate_cost(model, prompt_tokens, completion_tokens).cost_usd

    def calculate_savings(
        self,
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
        baseline_model: str | None = None,
    ) -> tuple[float, float]:
        chosen_cost = self.calculate_cost(model, prompt_tokens, completion_tokens).cost_usd
        baseline_cost = self.calculate_cost(
            baseline_model or settings.baseline_model,
            prompt_tokens,
            completion_tokens,
        ).cost_usd
        return baseline_cost, round(baseline_cost - chosen_cost, 8)

    def list_models(self) -> list[PricingEntry]:
        return sorted(self._entries.values(), key=lambda entry: (entry.provider, entry.model))

    def list_providers(self) -> list[dict[str, Any]]:
        grouped: dict[str, list[PricingEntry]] = {}
        for entry in self.list_models():
            grouped.setdefault(entry.provider, []).append(entry)
        return [
            {
                "provider": provider,
                "models": [model.to_dict() for model in models],
            }
            for provider, models in sorted(grouped.items())
        ]

    async def sync_from_url(self, url: str) -> None:
        if not url:
            return
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(url)
                response.raise_for_status()
                payload = response.json()
        except Exception:
            logger.warning("pricing.sync_failed", url=url)
            return

        entries = payload.get("models", payload) if isinstance(payload, dict) else payload
        if not isinstance(entries, list):
            logger.warning("pricing.invalid_catalog_payload", url=url)
            return

        updated: dict[str, PricingEntry] = dict(DEFAULT_CATALOG)
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            model_name = str(entry.get("model", "")).strip()
            provider = str(entry.get("provider", "")).strip()
            if not model_name or not provider:
                continue
            updated[model_name] = PricingEntry(
                model=model_name,
                provider=provider,
                input_cost_per_1k=float(entry.get("input_cost_per_1k", entry.get("input", 0.0)) or 0.0),
                output_cost_per_1k=float(
                    entry.get("output_cost_per_1k", entry.get("output", 0.0)) or 0.0
                ),
                context_window=int(entry.get("context_window", 128000) or 128000),
                max_output_tokens=int(entry.get("max_output_tokens", 4096) or 4096),
                supports_vision=bool(entry.get("supports_vision", False)),
                supports_streaming=bool(entry.get("supports_streaming", True)),
            )
        self._entries = updated
        logger.info("pricing.catalog_synced", url=url, models=len(updated))


pricing_catalog = PricingCatalog()


def calculate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> CostRecord:
    return pricing_catalog.calculate_cost(model, prompt_tokens, completion_tokens)
