from __future__ import annotations

import uuid
import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from openai import OpenAI
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.chat import Chat, ChatMessage
from app.models.syllabus_upload import SyllabusUpload
from app.schemas.chat_thread import (
    ChatDetailResponse,
    ChatListResponse,
    ChatOut,
    ChatQueryPayload,
    ChatQueryResponse,
    ChatRenamePayload,
    MessageOut,
)
from app.services.rag_engine import answer_question

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_user(x_user_id: str | None) -> str:
    if not x_user_id or not x_user_id.strip():
        raise HTTPException(status_code=400, detail="Missing or empty X-User-Id header")
    return x_user_id.strip()


def _chat_out(chat: Chat, db: Session) -> ChatOut:
    msg_count = db.scalar(
        select(func.count()).where(ChatMessage.chat_id == chat.id)
    ) or 0
    return ChatOut(
        id=str(chat.id),
        title=chat.title,
        active_model=chat.active_model,
        created_at=chat.created_at,
        message_count=msg_count,
    )


def _generate_title(question: str) -> str:
    """Call LLM for a short (≤ 6 word) chat title. Falls back gracefully."""
    if not settings.openai_api_key:
        return question[:48]
    try:
        client = OpenAI(api_key=settings.openai_api_key)
        resp = client.chat.completions.create(
            model=settings.chat_model,
            messages=[
                {
                    "role": "user",
                    "content": (
                        "Generate a concise 4-6 word title for a chat that starts with this question. "
                        "Reply with ONLY the title, no punctuation, no quotes:\n\n"
                        f"{question}"
                    ),
                }
            ],
            max_tokens=20,
            temperature=0.3,
        )
        raw = resp.choices[0].message.content or ""
        return raw.strip().strip('"').strip("'") or question[:48]
    except Exception:
        logger.warning("Title generation failed; using question truncation as fallback.")
        return question[:48]


# ---------------------------------------------------------------------------
# POST /chat/new  — create a new chat thread
# ---------------------------------------------------------------------------

@router.post("/new", response_model=ChatOut, status_code=201)
def new_chat(
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> ChatOut:
    user_id = _require_user(x_user_id)
    chat = Chat(
        id=uuid.uuid4(),
        user_id=user_id,
        title="New chat",
        active_model=settings.chat_model,
        created_at=datetime.utcnow(),
    )
    db.add(chat)
    db.commit()
    db.refresh(chat)
    return _chat_out(chat, db)


# ---------------------------------------------------------------------------
# GET /chat/list  — list all threads for the authenticated user
# ---------------------------------------------------------------------------

@router.get("/list", response_model=ChatListResponse)
def list_chats(
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> ChatListResponse:
    user_id = _require_user(x_user_id)
    chats = db.scalars(
        select(Chat)
        .where(Chat.user_id == user_id)
        .order_by(Chat.created_at.desc())
    ).all()
    return ChatListResponse(chats=[_chat_out(c, db) for c in chats])


# ---------------------------------------------------------------------------
# GET /chat/{chat_id}  — fetch chat detail with all messages
# ---------------------------------------------------------------------------

@router.get("/{chat_id}", response_model=ChatDetailResponse)
def get_chat(
    chat_id: str,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> ChatDetailResponse:
    user_id = _require_user(x_user_id)
    try:
        cid = UUID(chat_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid chat_id")

    chat = db.get(Chat, cid)
    if chat is None or chat.user_id != user_id:
        raise HTTPException(status_code=404, detail="Chat not found")

    msgs = db.scalars(
        select(ChatMessage)
        .where(ChatMessage.chat_id == cid)
        .order_by(ChatMessage.created_at.asc())
    ).all()

    msg_count = len(msgs)
    return ChatDetailResponse(
        id=str(chat.id),
        title=chat.title,
        active_model=chat.active_model,
        created_at=chat.created_at,
        message_count=msg_count,
        messages=[
            MessageOut(
                id=str(m.id),
                role=m.role,
                content=m.content,
                created_at=m.created_at,
            )
            for m in msgs
        ],
    )


# ---------------------------------------------------------------------------
# DELETE /chat/{chat_id}
# ---------------------------------------------------------------------------

@router.delete("/{chat_id}", status_code=204)
def delete_chat(
    chat_id: str,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> None:
    user_id = _require_user(x_user_id)
    try:
        cid = UUID(chat_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid chat_id")

    chat = db.get(Chat, cid)
    if chat is None or chat.user_id != user_id:
        raise HTTPException(status_code=404, detail="Chat not found")

    db.delete(chat)
    db.commit()


# ---------------------------------------------------------------------------
# PATCH /chat/{chat_id}  — rename a chat
# ---------------------------------------------------------------------------

@router.patch("/{chat_id}", response_model=ChatOut)
def rename_chat(
    chat_id: str,
    payload: ChatRenamePayload,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> ChatOut:
    user_id = _require_user(x_user_id)
    try:
        cid = UUID(chat_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid chat_id")

    chat = db.get(Chat, cid)
    if chat is None or chat.user_id != user_id:
        raise HTTPException(status_code=404, detail="Chat not found")

    chat.title = payload.title.strip()
    db.commit()
    db.refresh(chat)
    return _chat_out(chat, db)


# ---------------------------------------------------------------------------
# POST /chat/query  — RAG query, persists messages, auto-generates title
# ---------------------------------------------------------------------------

@router.post("/query", response_model=ChatQueryResponse)
def query_syllabus(
    payload: ChatQueryPayload,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> ChatQueryResponse:
    user_id = _require_user(x_user_id)

    # --- Validate syllabus ---
    try:
        sid = UUID(payload.syllabus_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid syllabus_id")

    row = db.get(SyllabusUpload, sid)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="Syllabus not found for this user")
    if row.status != "ready":
        raise HTTPException(
            status_code=409,
            detail=f"Syllabus is not ready for queries (status={row.status})",
        )

    # --- Validate chat ---
    try:
        cid = UUID(payload.chat_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid chat_id")

    chat = db.get(Chat, cid)
    if chat is None or chat.user_id != user_id:
        raise HTTPException(status_code=404, detail="Chat not found")

    # --- Check if this is the first message (for auto-title) ---
    existing_count = db.scalar(
        select(func.count()).where(ChatMessage.chat_id == cid)
    ) or 0
    is_first_message = existing_count == 0

    # --- Persist user message ---
    user_msg = ChatMessage(
        id=uuid.uuid4(),
        chat_id=cid,
        role="user",
        content=payload.question,
        created_at=datetime.utcnow(),
    )
    db.add(user_msg)
    db.flush()  # get ID without committing yet

    # --- Call RAG engine ---
    try:
        answer, citations = answer_question(user_id, str(sid), payload.question)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Query failed: {e!s}") from e

    # --- Persist AI response ---
    ai_msg = ChatMessage(
        id=uuid.uuid4(),
        chat_id=cid,
        role="ai",
        content=answer,
        created_at=datetime.utcnow(),
    )
    db.add(ai_msg)

    # --- Auto-generate title on first message ---
    if is_first_message:
        chat.title = _generate_title(payload.question)

    db.commit()

    # Build citation list
    from app.schemas.chat_thread import Citation as CitationOut
    cits = [
        CitationOut(
            chunk_id=c.chunk_id,
            page_start=c.page_start,
            page_end=c.page_end,
            quote=c.quote,
        )
        for c in citations[:5]
    ]

    return ChatQueryResponse(
        chat_id=str(cid),
        answer=answer,
        citations=cits,
        title=chat.title,
    )
