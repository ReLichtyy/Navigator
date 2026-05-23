from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Outbound schemas
# ---------------------------------------------------------------------------

class MessageOut(BaseModel):
    id: str
    role: str  # 'user' | 'ai'
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatOut(BaseModel):
    id: str
    title: str
    active_model: str
    created_at: datetime
    message_count: int = 0

    model_config = {"from_attributes": True}


class ChatDetailResponse(ChatOut):
    messages: list[MessageOut] = []


class ChatListResponse(BaseModel):
    chats: list[ChatOut]


# ---------------------------------------------------------------------------
# Inbound schemas
# ---------------------------------------------------------------------------

class ChatRenamePayload(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class ChatQueryPayload(BaseModel):
    """Extended query payload that binds a question to a persistent chat thread."""

    syllabus_id: str = Field(min_length=1)
    question: str = Field(min_length=1)
    chat_id: str = Field(min_length=1)


# ---------------------------------------------------------------------------
# Query response (augments existing ChatResponse with thread metadata)
# ---------------------------------------------------------------------------

class Citation(BaseModel):
    chunk_id: str
    page_start: int | None = None
    page_end: int | None = None
    quote: str


class ChatQueryResponse(BaseModel):
    chat_id: str
    answer: str
    citations: list[Citation]
    title: str  # returned so frontend can update sidebar title on first message
