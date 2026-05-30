"""Unit tests for the agent layer.

All tests are pure Python — no LLM calls, no Qdrant, no Elasticsearch.
Guardrails logic is tested in test_guardrails.py; this file covers only the
agent graph structure and routing / context-building helpers.
"""


from backend.agent.nodes.generator import _build_context
from backend.agent.nodes.retriever import (
    _RERANK_THRESHOLD,
    _RRF_THRESHOLD,
    _is_sufficient,
    route_after_retrieval,
)
from backend.agent.nodes.router import route_after_router
from backend.agent.state import AgentState
from backend.retrieval import SearchResult

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_state(**overrides) -> AgentState:
    base: AgentState = {
        "messages": [],
        "query": "What is the revenue?",
        "route": "knowledge_base",
        "iteration_count": 0,
        "retrieved_docs": [],
        "needs_web_search": False,
        "search_results": [],
        "response": "",
        "citations": [],
        "guardrail_flags": [],
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Router edge function
# ---------------------------------------------------------------------------


class TestRouteAfterRouter:
    def test_knowledge_base_goes_to_retriever(self):
        assert route_after_router(_make_state(route="knowledge_base")) == "knowledge_base"

    def test_web_search_goes_to_web_search(self):
        assert route_after_router(_make_state(route="web_search")) == "web_search"

    def test_clarify_goes_to_generator(self):
        assert route_after_router(_make_state(route="clarify")) == "generator"

    def test_chitchat_goes_to_generator(self):
        assert route_after_router(_make_state(route="chitchat")) == "generator"

    def test_missing_route_defaults_to_knowledge_base(self):
        state = _make_state()
        del state["route"]
        assert route_after_router(state) == "knowledge_base"


# ---------------------------------------------------------------------------
# Retriever edge function
# ---------------------------------------------------------------------------


class TestRouteAfterRetrieval:
    def test_sufficient_goes_to_generator(self):
        assert route_after_retrieval(_make_state(needs_web_search=False)) == "generator"

    def test_insufficient_goes_to_web_search(self):
        assert route_after_retrieval(_make_state(needs_web_search=True)) == "web_search"


def _result(score: float, source: str) -> SearchResult:
    return SearchResult(
        chunk_id="c1", content="x", source_file="a.txt", score=score, source=source
    )


class TestIsSufficient:
    """The sufficiency gate must use the right scale per result source."""

    def test_empty_is_insufficient(self):
        assert _is_sufficient([]) is False

    def test_reranked_uses_cohere_scale(self):
        # 0.3 clears the rerank threshold; 0.05 (which would clear the RRF
        # threshold) must NOT count as sufficient on the Cohere scale.
        assert _is_sufficient([_result(0.30, "reranked")]) is True
        assert _is_sufficient([_result(0.05, "reranked")]) is False

    def test_rrf_fallback_uses_rrf_scale(self):
        # On the RRF scale a small score is fine; near-zero is not.
        assert _is_sufficient([_result(0.02, "hybrid")]) is True
        assert _is_sufficient([_result(0.001, "hybrid")]) is False

    def test_reranked_threshold_boundary(self):
        assert _is_sufficient([_result(_RERANK_THRESHOLD, "reranked")]) is True

    def test_rrf_threshold_boundary(self):
        assert _is_sufficient([_result(_RRF_THRESHOLD, "hybrid")]) is True


# ---------------------------------------------------------------------------
# Generator — context building
# ---------------------------------------------------------------------------


class TestBuildContext:
    def test_kb_docs_included(self):
        state = _make_state(
            retrieved_docs=[{"source_file": "report.pdf", "page_number": 2,
                             "content": "Revenue was $10M."}]
        )
        ctx = _build_context(state)
        assert "report.pdf" in ctx
        assert "Revenue was $10M." in ctx

    def test_web_results_included(self):
        state = _make_state(
            search_results=[{"url": "https://example.com", "content": "Stock rose 5%."}]
        )
        ctx = _build_context(state)
        assert "example.com" in ctx
        assert "Stock rose 5%." in ctx

    def test_both_sources_included(self):
        state = _make_state(
            retrieved_docs=[{"source_file": "a.pdf", "page_number": 1, "content": "KB text"}],
            search_results=[{"url": "http://x.com", "content": "Web text"}],
        )
        ctx = _build_context(state)
        assert "KB text" in ctx
        assert "Web text" in ctx

    def test_empty_state_returns_empty(self):
        assert _build_context(_make_state()) == ""

    def test_context_truncated_to_max_chars(self):
        from backend.agent.nodes.generator import _MAX_CONTEXT_CHARS
        big = "x" * (_MAX_CONTEXT_CHARS + 5000)
        state = _make_state(
            retrieved_docs=[{"source_file": "f.pdf", "page_number": 1, "content": big}]
        )
        assert len(_build_context(state)) <= _MAX_CONTEXT_CHARS


# ---------------------------------------------------------------------------
# Graph structure (import-level smoke test, no LLM calls)
# ---------------------------------------------------------------------------


class TestGraphStructure:
    def test_graph_compiles(self):
        from backend.agent.graph import build_graph
        assert build_graph() is not None

    def test_graph_has_expected_nodes(self):
        from backend.agent.graph import build_graph
        node_names = set(build_graph().nodes.keys())
        for expected in ("router", "retriever", "web_search", "generator", "guardrails"):
            assert expected in node_names, f"Missing node: {expected}"
