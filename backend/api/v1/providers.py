"""
backend.api.v1.providers — Provider catalog and pricing metadata.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from backend.core.analytics import analytics_collector
from backend.core.auth import require_admin
from backend.core.pricing import pricing_catalog
from backend.utils.settings import settings

router = APIRouter(dependencies=[Depends(require_admin)])


@router.get("")
async def list_providers() -> dict[str, Any]:
    providers = []
    for provider in pricing_catalog.list_providers():
        models = []
        for model in provider["models"]:
            models.append(
                {
                    **model,
                    "p95_latency_ms": await analytics_collector.get_p95_latency(model["model"]),
                }
            )
        providers.append({"provider": provider["provider"], "models": models})
    return {"baseline_model": settings.baseline_model, "providers": providers}


@router.get("/{provider_name}")
async def get_provider(provider_name: str) -> dict[str, Any]:
    for provider in pricing_catalog.list_providers():
        if provider["provider"] == provider_name:
            return provider
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider not found")
