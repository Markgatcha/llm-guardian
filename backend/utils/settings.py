"""
backend.utils.settings — Pydantic-Settings application configuration.
"""

from __future__ import annotations

import json
from collections.abc import Iterable

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _parse_string_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        stripped = value.strip()
        if stripped == "":
            return []
        if stripped.startswith("["):
            loaded = json.loads(stripped)
            if isinstance(loaded, list):
                return [str(item).strip() for item in loaded if str(item).strip()]
        return [item.strip() for item in stripped.split(",") if item.strip()]
    if isinstance(value, Iterable):
        return [str(item).strip() for item in value if str(item).strip()]
    return [str(value).strip()]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    app_env: str = Field("development", alias="APP_ENV")
    log_level: str = Field("INFO", alias="LOG_LEVEL")
    secret_key: str = Field("change-me-32-chars-minimum", alias="SECRET_KEY")
    guardian_api_key: str = Field("", alias="GUARDIAN_API_KEY")
    allowed_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173"],
        alias="ALLOWED_ORIGINS",
    )

    database_url: str = Field("sqlite+aiosqlite:///./guardian.db", alias="DATABASE_URL")
    redis_url: str = Field("redis://localhost:6379/0", alias="REDIS_URL")

    cache_ttl_seconds: int = Field(300, alias="CACHE_TTL_SECONDS")
    semantic_cache_enabled: bool = Field(True, alias="SEMANTIC_CACHE_ENABLED")
    semantic_cache_threshold: float = Field(0.95, alias="SEMANTIC_CACHE_THRESHOLD")
    embedding_model: str = Field("text-embedding-ada-002", alias="EMBEDDING_MODEL")
    latency_window_size: int = Field(100, alias="LATENCY_WINDOW_SIZE")

    rate_limit_per_minute: int = Field(60, alias="RATE_LIMIT_PER_MINUTE")

    max_request_cost_usd: float = Field(1.0, alias="MAX_REQUEST_COST_USD")
    daily_budget_usd: float = Field(10.0, alias="DAILY_BUDGET_USD")
    monthly_budget_usd: float = Field(100.0, alias="MONTHLY_BUDGET_USD")
    expensive_model_threshold_usd: float = Field(0.10, alias="EXPENSIVE_MODEL_THRESHOLD_USD")

    pricing_catalog_url: str = Field("", alias="PRICING_CATALOG_URL")
    baseline_model: str = Field("gpt-4o", alias="BASELINE_MODEL")

    admin_api_keys: list[str] = Field(default_factory=list, alias="ADMIN_API_KEYS")

    openai_api_key: str = Field("", alias="OPENAI_API_KEY")
    groq_api_key: str = Field("", alias="GROQ_API_KEY")
    anthropic_api_key: str = Field("", alias="ANTHROPIC_API_KEY")
    azure_api_key: str = Field("", alias="AZURE_API_KEY")
    azure_api_base: str = Field("", alias="AZURE_API_BASE")
    azure_api_version: str = Field("", alias="AZURE_API_VERSION")
    vertexai_project: str = Field("", alias="VERTEXAI_PROJECT")
    vertexai_location: str = Field("", alias="VERTEXAI_LOCATION")
    google_application_credentials: str = Field("", alias="GOOGLE_APPLICATION_CREDENTIALS")
    ollama_api_base: str = Field("", alias="OLLAMA_API_BASE")
    mistral_api_key: str = Field("", alias="MISTRAL_API_KEY")
    cohere_api_key: str = Field("", alias="COHERE_API_KEY")

    @field_validator("allowed_origins", "admin_api_keys", mode="before")
    @classmethod
    def _validate_string_lists(cls, value: object) -> list[str]:
        return _parse_string_list(value)

    @field_validator(
        "max_request_cost_usd",
        "daily_budget_usd",
        "monthly_budget_usd",
        "expensive_model_threshold_usd",
        mode="after",
    )
    @classmethod
    def _validate_positive_budgets(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("Budget values must be positive.")
        return value


settings = Settings()  # type: ignore[call-arg]
