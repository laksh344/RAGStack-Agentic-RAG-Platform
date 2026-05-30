"""Admin endpoints — health check, stats, configuration."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends

from backend.api.deps import require_auth
from backend.config import settings

router = APIRouter()


def _safe_host(url: str) -> str:
    """Strip any credentials from a connection URL before exposing it."""
    return url.rsplit("@", 1)[-1]


@router.get("/health")
async def health_check():
    """Liveness probe — intentionally unauthenticated (used by Docker/Cloud Run)."""
    return {
        "status": "healthy",
        "timestamp": datetime.now(UTC).isoformat(),
        "version": "0.1.0",
        "services": {
            "qdrant": f"{settings.qdrant_host}:{settings.qdrant_port}",
            "elasticsearch": _safe_host(settings.es_host),
            "redis": _safe_host(settings.redis_url),
        },
    }


@router.get("/config")
async def get_config(_user: str = Depends(require_auth)):
    return {
        "llm_model": settings.openai_model,
        "embedding_model": settings.embedding_model,
        "chunk_size": settings.chunk_size,
        "chunk_overlap": settings.chunk_overlap,
        "langsmith_project": settings.langchain_project,
        "qdrant_collection": settings.qdrant_collection,
        "es_index": settings.es_index,
    }
