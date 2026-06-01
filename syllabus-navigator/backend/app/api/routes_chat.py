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
    ChatNewPayload,
    ChatOut,
    ChatQueryPayload,
    ChatQueryResponse,
    ChatUpdatePayload,
    Citation as CitationOut,
    MessageOut,
)
from app.services.rag_engine import answer_question

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_HISTORY_TURNS = 6


def _require_user(x_user_id: str | None) -> str:
    if not x_user_id or not x_user_id.strip():
        raise HTTPException(status_code=400, detail="Missing or empty X-User-Id header")
    return x_user_id.strip()


def _validate_syllabus_for_user(
    db: Session, user_id: str, syllabus_id: str | None
) -> UUID | None:
    if not syllabus_id:
        return None
    try:
        sid = UUID(syllabus_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid syllabus_id")
    row = db.get(SyllabusUpload, sid)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="Syllabus not found for this user")
    return sid


def _chat_out(chat: Chat, db: Session) -> ChatOut:
    msg_count = db.scalar(
        select(func.count()).where(ChatMessage.chat_id == chat.id)
    ) or 0
    return ChatOut(
        id=str(chat.id),
        title=chat.title,
        active_model=chat.active_model,
        syllabus_id=str(chat.syllabus_id) if chat.syllabus_id else None,
        created_at=chat.created_at,
        message_count=msg_count,
    )


def _message_out(msg: ChatMessage) -> MessageOut:
    cits: list[CitationOut] = []
    if msg.citations:
        for c in msg.citations:
            cits.append(
                CitationOut(
                    chunk_id=c.get("chunk_id", ""),
                    page_start=c.get("page_start"),
                    page_end=c.get("page_end"),
                    quote=c.get("quote", ""),
                )
            )
    return MessageOut(
        id=str(msg.id),
        role=msg.role,
        content=msg.content,
        created_at=msg.created_at,
        citations=cits,
    )


def _generate_title(question: str, model: str | None = None) -> str:
    """Call LLM for a short (≤ 6 word) chat title. Falls back gracefully."""
    if not settings.openai_api_key:
        return question[:48]
    chat_model = model or settings.chat_model
    try:
        client = OpenAI(api_key=settings.openai_api_key)
        resp = client.chat.completions.create(
            model=chat_model,
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


@router.post("/new", response_model=ChatOut, status_code=201)
def new_chat(
    payload: ChatNewPayload | None = None,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> ChatOut:
    user_id = _require_user(x_user_id)
    syllabus_uuid = None
    if payload and payload.syllabus_id:
        syllabus_uuid = _validate_syllabus_for_user(db, user_id, payload.syllabus_id)

    chat = Chat(
        id=uuid.uuid4(),
        user_id=user_id,
        title="New chat",
        active_model=settings.chat_model,
        syllabus_id=syllabus_uuid,
        created_at=datetime.utcnow(),
    )
    db.add(chat)
    db.commit()
    db.refresh(chat)
    return _chat_out(chat, db)


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


@router.get("/models")
def list_chat_models() -> dict[str, list[str] | str]:
    return {"models": settings.chat_models_list, "default": settings.chat_model}


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

    return ChatDetailResponse(
        id=str(chat.id),
        title=chat.title,
        active_model=chat.active_model,
        syllabus_id=str(chat.syllabus_id) if chat.syllabus_id else None,
        created_at=chat.created_at,
        message_count=len(msgs),
        messages=[_message_out(m) for m in msgs],
    )


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


@router.patch("/{chat_id}", response_model=ChatOut)
def update_chat(
    chat_id: str,
    payload: ChatUpdatePayload,
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

    if payload.title is not None:
        chat.title = payload.title.strip()
    if payload.syllabus_id is not None:
        if payload.syllabus_id == "":
            chat.syllabus_id = None
        else:
            chat.syllabus_id = _validate_syllabus_for_user(db, user_id, payload.syllabus_id)
    if payload.active_model is not None:
        if payload.active_model not in settings.chat_models_list:
            raise HTTPException(
                status_code=400,
                detail=f"Model not allowed. Choose from: {', '.join(settings.chat_models_list)}",
            )
        chat.active_model = payload.active_model

    db.commit()
    db.refresh(chat)
    return _chat_out(chat, db)


@router.post("/query", response_model=ChatQueryResponse)
def query_syllabus(
    payload: ChatQueryPayload,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> ChatQueryResponse:
    user_id = _require_user(x_user_id)

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

    try:
        cid = UUID(payload.chat_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid chat_id")

    chat = db.get(Chat, cid)
    if chat is None or chat.user_id != user_id:
        raise HTTPException(status_code=404, detail="Chat not found")

    if chat.syllabus_id is None:
        chat.syllabus_id = sid

    existing_msgs = db.scalars(
        select(ChatMessage)
        .where(ChatMessage.chat_id == cid)
        .order_by(ChatMessage.created_at.asc())
    ).all()
    is_first_message = len(existing_msgs) == 0

    history: list[tuple[str, str]] = []
    recent = existing_msgs[-MAX_HISTORY_TURNS * 2 :] if existing_msgs else []
    for m in recent:
        history.append((m.role, m.content))

    user_msg = ChatMessage(
        id=uuid.uuid4(),
        chat_id=cid,
        role="user",
        content=payload.question,
        created_at=datetime.utcnow(),
    )
    db.add(user_msg)
    db.flush()

    try:
        answer, citations = answer_question(
            user_id,
            str(sid),
            payload.question,
            history=history,
            model=chat.active_model,
        )
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Query failed: {e!s}") from e

    citations_data = [
        {
            "chunk_id": c.chunk_id,
            "page_start": c.page_start,
            "page_end": c.page_end,
            "quote": c.quote,
        }
        for c in citations[:5]
    ]

    ai_msg = ChatMessage(
        id=uuid.uuid4(),
        chat_id=cid,
        role="ai",
        content=answer,
        citations=citations_data if citations_data else None,
        created_at=datetime.utcnow(),
    )
    db.add(ai_msg)

    if is_first_message:
        chat.title = _generate_title(payload.question, chat.active_model)

    db.commit()

    cits = [CitationOut(**c) for c in citations_data]

    return ChatQueryResponse(
        chat_id=str(cid),
        answer=answer,
        citations=cits,
        title=chat.title,
    )
