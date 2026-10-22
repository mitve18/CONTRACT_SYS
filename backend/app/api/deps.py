from __future__ import annotations

import json
from collections.abc import Iterator

from fastapi import Header, HTTPException
from fastapi.responses import StreamingResponse

from app.core.config import get_settings


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    expected = get_settings().api_key
    if expected and x_api_key != expected:
        raise HTTPException(status_code=401, detail="unauthorized")


def sse(events: Iterator[dict]) -> StreamingResponse:
    """Server-sent events from a sync generator (Starlette runs it in a worker thread)."""

    def body() -> Iterator[str]:
        for event in events:
            yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"

    return StreamingResponse(
        body(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
