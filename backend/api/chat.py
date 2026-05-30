"""Chat API — agentic RAG conversation with SSE streaming and Redis history.

POST /api/v1/chat            — run the agent, stream the response via SSE
POST /api/v1/chat/feedback   — record thumbs-up / thumbs-down on a message
GET  /api/v1/chat/{id}       — retrieve full conversation history

SSE event types emitted during streaming:
  {"type": "token",          "content": " word"}  — one or more words
  {"type": "citations",      "data":    [...]}     — after full response
  {"type": "guardrail_flags","data":    [...]}     — safety flags
  {"type": "done",           "message_id": "...",
                             "conversation_id": "..."}
  {"type": "error",          "detail": "..."}      — on failure
"""

import asyncio
import json
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from uuid import uuid4

import structlog
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from pydantic import BaseModel

from backend.agent.state import AgentState
from backend.api.deps import require_auth
from backend.config import settings
from backend.guardrails import get_input_validator, get_pii_redactor
from backend.models.conversation import Conversation, Message

logger = structlog.get_logger()
router = APIRouter()

# Shared guardrail singletons (Presidio/spaCy is expensive to construct).
_validator = get_input_validator()
_pii = get_pii_redactor()

# ---------------------------------------------------------------------------
# Redis configuration
# ---------------------------------------------------------------------------

_CONV_TTL_SECONDS = 86_400        # 24 h per conversation
_FEEDBACK_TTL_SECONDS = 86_400 * 30  # 30 d per feedback record
_MAX_HISTORY_MESSAGES = 20        # messages loaded for LLM context window


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class ChatRequest(BaseModel):
    query: str
    conversation_id: str | None = None
    dataset_id: str | None = None  # reserved for future per-dataset filtering


class FeedbackRequest(BaseModel):
    message_id: str
    rating: int   # 1 positive, -1 negative, 0 neutral
    comment: str = ""


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/chat")
async def chat(request: ChatRequest, user_id: str = Depends(require_auth)):
    """Invoke the LangGraph agent and stream the response via Server-Sent Events."""
    return StreamingResponse(
        _stream_chat(request, user_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",   # disable Nginx proxy buffering
        },
    )


@router.post("/chat/feedback")
async def submit_feedback(
    request: FeedbackRequest, user_id: str = Depends(require_auth)
):
    """Store user feedback for a message (feeds LangSmith datasets in Week 3)."""
    redis = await _get_redis()
    if redis is None:
        logger.warning("chat.feedback.redis_unavailable")
        return {"status": "ok", "message_id": request.message_id, "stored": False}

    try:
        key = f"feedback:{user_id}:{request.message_id}"
        await redis.hset(
            key,
            mapping={
                "rating": request.rating,
                "comment": request.comment,
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )
        await redis.expire(key, _FEEDBACK_TTL_SECONDS)
        return {"status": "ok", "message_id": request.message_id, "stored": True}
    finally:
        await redis.aclose()


@router.get("/chat/conversations")
async def list_conversations(user_id: str = Depends(require_auth)):
    """List the caller's conversations with a short preview, newest first.

    Scoped to the authenticated user so one user can never see another's chats.
    Returns an empty list if Redis is unavailable so the UI degrades gracefully.
    """
    redis = await _get_redis()
    if redis is None:
        return {"conversations": [], "count": 0}

    try:
        summaries: list[dict] = []
        pattern = f"conversation:{user_id}:*:messages"
        async for key in redis.scan_iter(match=pattern, count=100):
            # key = conversation:{user_id}:{conv_id}:messages
            conv_id = key.split(":")[2]
            raw = await redis.lrange(key, 0, -1)
            if not raw:
                continue
            messages = [Message.model_validate(json.loads(m)) for m in raw]
            first_user = next((m for m in messages if m.role == "user"), messages[0])
            summaries.append(
                {
                    "conversation_id": conv_id,
                    "preview": first_user.content[:80],
                    "message_count": len(messages),
                    "updated_at": messages[-1].timestamp,
                }
            )

        summaries.sort(key=lambda s: s["updated_at"], reverse=True)
        return {"conversations": summaries[:50], "count": len(summaries)}
    finally:
        await redis.aclose()


@router.get("/chat/{conversation_id}", response_model=Conversation)
async def get_conversation(
    conversation_id: str, user_id: str = Depends(require_auth)
):
    """Return full history for one of the caller's conversations.

    The Redis key is namespaced by user_id, so requesting another user's
    conversation_id simply yields "not found" (no cross-user reads).
    """
    redis = await _get_redis()
    if redis is None:
        raise HTTPException(status_code=503, detail="Conversation store unavailable")

    try:
        raw_messages = await _load_raw_messages(redis, user_id, conversation_id)
        if not raw_messages:
            raise HTTPException(status_code=404, detail="Conversation not found")

        messages = [Message.model_validate(json.loads(m)) for m in raw_messages]
        return Conversation(
            id=conversation_id,
            messages=messages,
            message_count=len(messages),
        )
    finally:
        await redis.aclose()


# ---------------------------------------------------------------------------
# Core streaming generator
# ---------------------------------------------------------------------------


async def _stream_chat(
    request: ChatRequest, user_id: str
) -> AsyncGenerator[str, None]:
    """Run the agent and yield SSE events."""
    conversation_id = request.conversation_id or str(uuid4())
    redis = await _get_redis()

    try:
        # --- Load conversation history from Redis ---
        history: list[Message] = []
        if redis:
            raw = await _load_raw_messages(redis, user_id, conversation_id)
            history = [Message.model_validate(json.loads(m)) for m in raw]

        # --- Persist the user message as typed (their own history) ---
        user_msg = Message(role="user", content=request.query)
        if redis:
            await _append_message(redis, user_id, conversation_id, user_msg)

        # --- Pre-generation guardrails on the INPUT (before any LLM call) ---
        validation = _validator.validate(request.query)
        if "prompt_injection_detected" in validation.flags:
            async for evt in _refuse(
                redis, user_id, conversation_id,
                "I can't help with that — it looks like an attempt to override "
                "my instructions.",
                validation.flags,
            ):
                yield evt
            return

        # Redact PII from the query before it reaches the LLM or embeddings,
        # so user PII is never sent to a third-party provider.
        safe_query = _pii.redact(request.query).redacted_text

        # --- Build LangGraph initial state ---
        lc_history = _to_langchain_messages(history)
        initial_state: AgentState = {
            "query": safe_query,
            "messages": lc_history,
            "route": "",
            "iteration_count": 0,
            "retrieved_docs": [],
            "needs_web_search": False,
            "search_results": [],
            "response": "",
            "citations": [],
            "guardrail_flags": [],
        }

        # --- Invoke LangGraph agent (full run, then stream result) ---
        from backend.agent.graph import graph  # deferred to avoid circular import at module load

        result = await graph.ainvoke(initial_state)

        response_text: str = result.get("response", "")
        citations: list = result.get("citations", [])
        flags: list = result.get("guardrail_flags", [])

        # --- Persist assistant message ---
        assistant_msg = Message(
            role="assistant",
            content=response_text,
            citations=citations,
            guardrail_flags=flags,
        )
        if redis:
            await _append_message(redis, user_id, conversation_id, assistant_msg)

        # --- Stream response word by word ---
        words = response_text.split(" ")
        for i, word in enumerate(words):
            chunk = word if i == len(words) - 1 else word + " "
            yield _sse({"type": "token", "content": chunk})
            await asyncio.sleep(0)   # yield to event loop; no artificial delay

        # --- Emit trailing metadata events ---
        yield _sse({"type": "citations", "data": citations})
        yield _sse({"type": "guardrail_flags", "data": flags})
        yield _sse({
            "type": "done",
            "message_id": assistant_msg.id,
            "conversation_id": conversation_id,
        })

        logger.info(
            "chat.complete",
            conversation_id=conversation_id,
            response_len=len(response_text),
            citations=len(citations),
            flags=flags,
        )

    except Exception as exc:
        logger.error("chat.error", error=str(exc))
        yield _sse({"type": "error", "detail": str(exc)})

    finally:
        if redis:
            await redis.aclose()


# ---------------------------------------------------------------------------
# Redis helpers
# ---------------------------------------------------------------------------


async def _get_redis():
    """Return an async Redis client, or None if Redis is unavailable."""
    try:
        import redis.asyncio as aioredis  # noqa: PLC0415

        client = aioredis.from_url(settings.redis_url, decode_responses=True)
        await client.ping()
        return client
    except Exception as exc:
        logger.warning("chat.redis_unavailable", error=str(exc))
        return None


def _conv_key(user_id: str, conversation_id: str) -> str:
    """User-namespaced Redis key for a conversation's message list."""
    return f"conversation:{user_id}:{conversation_id}:messages"


async def _load_raw_messages(redis, user_id: str, conversation_id: str) -> list[str]:
    """Return the last N serialised message strings for a conversation."""
    key = _conv_key(user_id, conversation_id)
    # LRANGE 0 -1 returns all; we limit by slicing from the tail.
    raw: list[str] = await redis.lrange(key, -_MAX_HISTORY_MESSAGES, -1)
    return raw


async def _append_message(
    redis, user_id: str, conversation_id: str, message: Message
) -> None:
    """Append a message and reset the TTL on the conversation key."""
    key = _conv_key(user_id, conversation_id)
    await redis.rpush(key, message.model_dump_json())
    await redis.expire(key, _CONV_TTL_SECONDS)


# ---------------------------------------------------------------------------
# Misc helpers
# ---------------------------------------------------------------------------


def _to_langchain_messages(history: list[Message]) -> list[BaseMessage]:
    """Convert stored Message objects to LangChain BaseMessage instances."""
    out: list[BaseMessage] = []
    for m in history:
        if m.role == "user":
            out.append(HumanMessage(content=m.content))
        elif m.role == "assistant":
            out.append(AIMessage(content=m.content))
    return out


def _sse(payload: dict) -> str:
    """Format a dict as an SSE data line."""
    return f"data: {json.dumps(payload)}\n\n"


async def _refuse(
    redis,
    user_id: str,
    conversation_id: str,
    message: str,
    flags: list[str],
) -> AsyncGenerator[str, None]:
    """Stream a guardrail refusal as a normal assistant turn and persist it.

    Persisting the refusal keeps the conversation consistent (no dangling user
    turn) when input guardrails block a request.
    """
    assistant_msg = Message(role="assistant", content=message, guardrail_flags=flags)
    if redis:
        await _append_message(redis, user_id, conversation_id, assistant_msg)

    for word in message.split(" "):
        yield _sse({"type": "token", "content": word + " "})
        await asyncio.sleep(0)

    yield _sse({"type": "guardrail_flags", "data": flags})
    yield _sse({
        "type": "done",
        "message_id": assistant_msg.id,
        "conversation_id": conversation_id,
    })
    logger.info("chat.blocked", conversation_id=conversation_id, flags=flags)
