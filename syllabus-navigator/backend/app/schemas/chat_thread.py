from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class MessageOut(BaseModel):
    id: str
    role: str  # 'user' | 'ai'
    content: str
    created_at: datetime
    citations: list["Citation"] = []

    model_config = {"from_attributes": True}


class ChatOut(BaseModel):
    id: str
    title: str
    active_model: str
    syllabus_id: str | None = None
    created_at: datetime
    message_count: int = 0

    model_config = {"from_attributes": True}


class ChatDetailResponse(ChatOut):
    messages: list[MessageOut] = []


class ChatListResponse(BaseModel):
    chats: list[ChatOut]


class ChatNewPayload(BaseModel):
    syllabus_id: str | None = None


class ChatUpdatePayload(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    syllabus_id: str | None = None
    active_model: str | None = None


class ChatQueryPayload(BaseModel):
    """Extended query payload that binds a question to a persistent chat thread."""

    syllabus_id: str = Field(min_length=1)
    question: str = Field(min_length=1)
    chat_id: str = Field(min_length=1)


class Citation(BaseModel):
    chunk_id: str
    page_start: int | None = None
    page_end: int | None = None
    quote: str


class ChatQueryResponse(BaseModel):
    chat_id: str
    answer: str
    citations: list[Citation]
    title: str


class SyllabusUploadOut(BaseModel):
    id: str
    original_filename: str
    status: str
    graph_status: str
    created_at: datetime


class SyllabusListResponse(BaseModel):
    uploads: list[SyllabusUploadOut]
