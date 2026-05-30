"""LangChain tool definitions for the RAGStack agent.

These are callable tool objects that nodes can invoke directly or that
could be exposed to a ReAct-style agent in future iterations.
"""

import structlog
from langchain_core.tools import tool

from backend.config import settings

logger = structlog.get_logger()


@tool
async def hybrid_search(query: str, k: int = 10) -> list[dict]:
    """Search the knowledge base using hybrid vector + BM25 retrieval with reranking.

    Args:
        query: Natural-language question or search query.
        k: Number of results to return after reranking.

    Returns:
        List of chunk dicts with content, source_file, page_number, score.
    """
    from backend.retrieval.hybrid import HybridSearcher
    from backend.retrieval.reranker import Reranker

    searcher = HybridSearcher()
    reranker = Reranker()

    candidates = await searcher.search(query, k=k * 2)
    reranked = await reranker.rerank(query, candidates, top_k=k)
    return [r.model_dump() for r in reranked]


def web_search(query: str, max_results: int = 5) -> list[dict]:
    """Run a Tavily web search and return normalised result dicts.

    Uses the official ``tavily-python`` client directly. The deprecated
    LangChain TavilySearchResults wrapper mishandles the API key (returns
    401) and is being removed in LangChain 1.0, so we bypass it.

    Returns a list of {"title", "url", "content", "score"} dicts.
    """
    from tavily import TavilyClient  # noqa: PLC0415

    client = TavilyClient(api_key=settings.tavily_api_key)
    response = client.search(query, max_results=max_results, include_answer=False)
    results = response.get("results", []) if isinstance(response, dict) else []
    return [
        {
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "content": r.get("content", ""),
            "score": r.get("score", 0.0),
        }
        for r in results
    ]
