"""Shared FastAPI dependencies — authentication.

Auth is **opt-in**: it is enforced only when ``API_KEYS`` is configured. With
no keys set the service runs in open (dev/demo) mode and every caller shares a
single ``"local"`` user. When keys are configured, each distinct key maps to a
stable, opaque ``user_id`` so per-user data (conversations) is isolated.
"""

import hashlib

import structlog
from fastapi import Header, HTTPException

from backend.config import settings

logger = structlog.get_logger()


def _extract_key(x_api_key: str | None, authorization: str | None) -> str | None:
    """Pull the API key from either X-API-Key or 'Authorization: Bearer <key>'."""
    if x_api_key:
        return x_api_key.strip()
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def _user_id_for(key: str) -> str:
    """Derive a stable, opaque user id from an API key (never reversible)."""
    return "u_" + hashlib.sha256(key.encode()).hexdigest()[:12]


async def require_auth(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    authorization: str | None = Header(default=None),
) -> str:
    """Authenticate the request and return the caller's user_id.

    - No keys configured  → open mode, returns "local".
    - Keys configured     → requires a valid key, returns a per-key user_id;
                            otherwise raises 401.
    """
    allowed = settings.api_key_set
    if not allowed:
        return "local"

    provided = _extract_key(x_api_key, authorization)
    if not provided or provided not in allowed:
        logger.warning("auth.rejected", has_key=bool(provided))
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid API key.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _user_id_for(provided)
