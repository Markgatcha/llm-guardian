"""
backend.api.v1.chat — Backward-compatible alias for chat completions.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.proxy import ChatCompletionRequest, process_chat_completion
from backend.utils.db import get_session

router = APIRouter()
SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.post("/completions", response_model=None)
async def chat_completions(
    payload: ChatCompletionRequest,
    request: Request,
    session: SessionDep,
) -> JSONResponse | StreamingResponse:
    return await process_chat_completion(payload, request=request, session=session)
