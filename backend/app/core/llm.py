"""Model tiers, token accounting and the daily budget.

Every LLM call in the system goes through `model_for(tier)` and `record_usage(...)`,
so cost is visible per agent and the budget is enforced in one place.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from sqlalchemy import func, select

from app.core.config import get_settings
from app.db.models import TokenUsage
from app.db.session import session_scope

log = logging.getLogger(__name__)

Tier = Literal["fast", "main", "draft", "review"]

# USD per 1M tokens: (input, cached input, output). Approximate; used for the cost dashboard only.
PRICES: dict[str, tuple[float, float, float]] = {
    "gpt-4.1-mini": (0.40, 0.10, 1.60),
    "gpt-4.1": (2.00, 0.50, 8.00),
    "gpt-4.1-nano": (0.10, 0.025, 0.40),
    "gpt-5.5": (1.25, 0.125, 10.00),  # estimate
    "gpt-5.4-mini": (0.25, 0.025, 2.00),  # estimate
    "gpt-5.4": (1.25, 0.125, 10.00),  # estimate
    "gpt-5-mini": (0.25, 0.025, 2.00),
    "gpt-5": (1.25, 0.125, 10.00),
    "claude-haiku-5-5": (1.00, 0.10, 5.00),
    "claude-sonnet-5-5": (3.00, 0.30, 15.00),
    "claude-opus-5-5": (5.00, 0.50, 25.00),
    "text-embedding-3-large": (0.13, 0.13, 0.0),
    "text-embedding-3-small": (0.02, 0.02, 0.0),
}

MAX_OUTPUT: dict[Tier, int] = {"fast": 1200, "main": 2500, "draft": 14000, "review": 6000}


class BudgetExceeded(RuntimeError):
    pass


def model_id(tier: Tier) -> str:
    s = get_settings()
    return getattr(s, f"{s.provider}_{tier}_model")


def is_reasoning_model(name: str) -> bool:
    return name.startswith(("gpt-5", "gpt-6", "o1", "o3", "o4"))


def model_for(tier: Tier, *, max_tokens: int | None = None, temperature: float = 0.2) -> Any:
    """Build an Agno model for a tier. Static prompts go first so provider-side prompt caching works."""
    s = get_settings()
    limit = max_tokens or MAX_OUTPUT[tier]
    if s.provider == "anthropic":
        from agno.models.anthropic import Claude

        return Claude(
            id=model_id(tier),
            api_key=s.anthropic_api_key,
            max_tokens=limit,
            temperature=temperature,
            cache_system_prompt=True,
        )
    from agno.models.openai import OpenAIChat

    # OpenAI caches identical prompt prefixes over 1024 tokens automatically.
    name = model_id(tier)
    if is_reasoning_model(name):
        # Reasoning models take no temperature, and their hidden reasoning counts toward
        # max_completion_tokens, so the limit is set higher and effort kept low/medium.
        return OpenAIChat(
            id=name,
            api_key=s.openai_api_key,
            max_completion_tokens=max(limit, 4000),
            reasoning_effort="medium" if tier == "review" else "low",
        )
    return OpenAIChat(id=name, api_key=s.openai_api_key, max_tokens=limit, temperature=temperature)


def estimate_cost(model: str, input_tokens: int, output_tokens: int, cached_tokens: int = 0) -> float:
    price = next((p for name, p in PRICES.items() if model.startswith(name)), None)
    if price is None:
        return 0.0
    fresh = max(input_tokens - cached_tokens, 0)
    return (fresh * price[0] + cached_tokens * price[1] + output_tokens * price[2]) / 1_000_000


def record_usage(
    agent: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cached_tokens: int = 0,
    request_id: str | None = None,
) -> dict[str, Any]:
    cost = estimate_cost(model, input_tokens, output_tokens, cached_tokens)
    try:
        with session_scope() as db:
            db.add(
                TokenUsage(
                    agent=agent,
                    model=model,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    cached_tokens=cached_tokens,
                    cost_usd=cost,
                    request_id=request_id,
                )
            )
    except Exception:  # accounting must never break a user request
        log.exception("failed to record token usage")
    return {
        "agent": agent,
        "model": model,
        "input": input_tokens,
        "output": output_tokens,
        "cached": cached_tokens,
        "cost": cost,
    }


def record_run(agent: str, run: Any, request_id: str | None = None) -> dict[str, Any]:
    """Record an Agno RunOutput's metrics."""
    m = getattr(run, "metrics", None)
    model = getattr(run, "model", None) or "unknown"
    if m is None:
        return record_usage(agent, model, 0, 0, 0, request_id)
    return record_usage(
        agent,
        model,
        int(m.input_tokens or 0),
        int(m.output_tokens or 0),
        int(m.cache_read_tokens or 0),
        request_id,
    )


def tokens_used_today() -> int:
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    with session_scope() as db:
        total = db.scalar(
            select(func.coalesce(func.sum(TokenUsage.input_tokens + TokenUsage.output_tokens), 0)).where(
                TokenUsage.created_at >= since
            )
        )
    return int(total or 0)


def ensure_budget() -> None:
    limit = get_settings().daily_token_budget
    if limit and tokens_used_today() >= limit:
        raise BudgetExceeded("הגעתם למכסת הטוקנים היומית. אפשר להגדיל אותה ב-DAILY_TOKEN_BUDGET.")
