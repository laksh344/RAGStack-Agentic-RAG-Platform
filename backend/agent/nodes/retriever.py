"""Retriever node — hybrid search + relevance-based sufficiency check.

Calls the full hybrid pipeline (vector + BM25 → RRF → Cohere rerank).
If the top result's score is below the relevance threshold, it sets
``needs_web_search=True`` so the graph falls back to Tavily.
"""

import structlog

from backend.agent.state import AgentState
from backend.retrieval import SearchResult
from backend.retrieval.hybrid import HybridSearcher
from backend.retrieval.reranker import Reranker

logger = structlog.get_logger()

# The top result's score lives on one of two scales depending on whether the
# Cohere reranker actually ran:
#   - "reranked"  → Cohere cross-encoder relevance, 0-1. A genuinely relevant
#                   chunk scores well above 0.2; below that it's noise.
#   - otherwise   → RRF fusion score, which tops out ~0.033 for a rank-1 hit
#                   in both lists. ~0.008 means "present in the top results".
# Applying a single threshold to both scales (the previous bug) made the
# web-search fallback fire either almost never or almost always.
_RERANK_THRESHOLD = 0.20
_RRF_THRESHOLD    = 0.008
_FETCH_K = 20   # candidates to retrieve before reranking
_FINAL_K = 5    # results to keep after reranking


def _is_sufficient(results: list[SearchResult]) -> bool:
    """Decide if retrieval is good enough to skip the web-search fallback.

    Scale-aware: picks the threshold based on whether the top result was
    actually reranked by Cohere (0-1 scale) or is a raw RRF score.
    """
    if not results:
        return False
    top = results[0]
    threshold = _RERANK_THRESHOLD if top.source == "reranked" else _RRF_THRESHOLD
    return top.score >= threshold


async def retriever_node(state: AgentState) -> dict:
    """Run hybrid search, rerank, and evaluate sufficiency."""
    query = state["query"]
    searcher = HybridSearcher()
    reranker = Reranker()

    candidates = await searcher.search(query, k=_FETCH_K)
    results = await reranker.rerank(query, candidates, top_k=_FINAL_K)

    sufficient = _is_sufficient(results)

    logger.info(
        "retriever.complete",
        candidates=len(candidates),
        results=len(results),
        top_score=results[0].score if results else 0.0,
        top_source=results[0].source if results else "none",
        sufficient=sufficient,
    )

    return {
        "retrieved_docs": [r.model_dump() for r in results],
        "needs_web_search": not sufficient,
    }


def route_after_retrieval(state: AgentState) -> str:
    """Conditional edge: insufficient retrieval falls back to web search."""
    return "web_search" if state.get("needs_web_search") else "generator"
