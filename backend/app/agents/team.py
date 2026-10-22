"""The agent roster. Each agent gets its own model tier, a short static prompt and only the tools it needs.

Orchestration lives in app.services (plain Python, not an LLM coordinator),
so no tokens are spent on deciding which agent runs next.
"""

from __future__ import annotations

from agno.agent import Agent

from app.agents import prompts
from app.agents.schemas import DocumentMetadata, Review, RouteDecision
from app.core.config import get_settings
from app.core.llm import model_for


def _agent(name: str, tier: str, instructions: str, **kwargs) -> Agent:
    max_tokens = kwargs.pop("max_tokens", None)
    temperature = kwargs.pop("temperature", 0.2)
    return Agent(
        name=name,
        model=model_for(tier, max_tokens=max_tokens, temperature=temperature),  # type: ignore[arg-type]
        instructions=instructions,
        use_instruction_tags=False,
        markdown=False,
        telemetry=False,
        **kwargs,
    )


def metadata_agent() -> Agent:
    return _agent("metadata", "fast", prompts.METADATA, output_schema=DocumentMetadata, max_tokens=700, temperature=0)


def router_agent() -> Agent:
    return _agent("router", "fast", prompts.ROUTER, output_schema=RouteDecision, max_tokens=200, temperature=0)


def librarian_agent() -> Agent:
    return _agent("librarian", "main", prompts.LIBRARIAN, max_tokens=1800)


def web_agent() -> Agent:
    s = get_settings()
    if s.tavily_api_key:
        from agno.tools.tavily import TavilyTools

        tools = [TavilyTools(api_key=s.tavily_api_key, max_tokens=2500, search_depth="basic")]
    else:
        from agno.tools.duckduckgo import DuckDuckGoTools

        tools = [DuckDuckGoTools(enable_news=False, fixed_max_results=5, region="il-he")]
    return _agent("web_researcher", "fast", prompts.WEB, tools=tools, tool_call_limit=2, max_tokens=600)


def drafter_agent() -> Agent:
    return _agent("drafter", "draft", prompts.DRAFTER, temperature=0.3)


def reviewer_agent() -> Agent:
    return _agent("reviewer", "main", prompts.REVIEWER, output_schema=Review, max_tokens=1800, temperature=0)


def reviser_agent() -> Agent:
    return _agent("reviser", "main", prompts.REVISER, max_tokens=4000, temperature=0.2)
