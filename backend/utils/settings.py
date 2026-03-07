"""
backend.utils.settings — Pydantic-Settings application configuration.

Values are loaded in this priority order:
  1. Environment variables
  2. .env file (auto-loaded by Pydantic)
  3. Field defaults
"""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Application
    app_env: str = Field("development", alias="APP_ENV")
    log_level: str = Field("INFO", alias="LOG_LEVEL")
    secret_key: str = Field("change-me-32-chars-minimum", alias="SECRET_KEY")
    guardian_api_key: str = Field("", alias="GUARDIAN_API_KEY")
    allowed_origins: list[str] = Field(
        default=["http://localhost:5173"], alias="ALLOWED_ORIGINS"
    )

    # Database
    database_url: str = Field(
        "sqlite+aiosqlite:///./guardian.db", alias="DATABASE_URL"
    )

    # Redis
    redis_url: str = Field("redis://localhost:6379/0", alias="REDIS_URL")

    # Cache
    cache_ttl_seconds: int = Field(300, alias="CACHE_TTL_SECONDS")

    # Rate limiting
    rate_limit_per_minute: int = Field(60, alias="RATE_LIMIT_PER_MINUTE")

    # LLM provider keys — forwarded to LiteLLM via env
    openai_api_key: str = Field("", alias="OPENAI_API_KEY")
    anthropic_api_key: str = Field("", alias="ANTHROPIC_API_KEY")


# Module-level singleton — import from here everywhere else.
settings = Settings()
