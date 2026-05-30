"""Web search node — Tavily fallback when knowledge base retrieval is insufficient.

Triggered either directly (router intent = "web_search") or as a fallback
after the retriever decides the KB results are below the relevance threshold.
"""

import asyncio

import structlog

from backend.agent.state import AgentState
from backend.agent.tools import web_search
from backend.config import settings

logger = structlog.get_logger()

_MAX_RESULTS = 5


async def web_search_node(state: AgentState) -> dict:
    """Run Tavily search and store results in state."""
    if not settings.tavily_api_key:
        logger.warning("web_search.no_api_key")
        return {
            "search_results": [],
            "guardrail_flags": state.get("guardrail_flags", []) + ["web_search_unavailable"],
        }

    # Web search is a best-effort fallback. Any failure (bad key, network,
    # rate limit) degrades to "no web results" rather than crashing the agent —
    # the generator can still answer from knowledge-base context or say it
    # doesn't know.
    try:
        # TavilyClient is synchronous — run it off the event loop.
        results = await asyncio.to_thread(web_search, state["query"], _MAX_RESULTS)
        logger.info("web_search.complete", results=len(results))
        return {"search_results": results}
    except Exception as exc:
        logger.warning("web_search.failed", error=str(exc))
        return {
            "search_results": [],
            "guardrail_flags": state.get("guardrail_flags", []) + ["web_search_failed"],
        }
