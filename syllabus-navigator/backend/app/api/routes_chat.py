from fastapi import APIRouter

from app.schemas.syllabus import ChatQuery, ChatResponse
from app.services.rag_engine import answer_question


router = APIRouter()


@router.post("/query", response_model=ChatResponse)
def query_syllabus(payload: ChatQuery) -> ChatResponse:
    answer, citations = answer_question(payload.syllabus_id, payload.question)
    return ChatResponse(answer=answer, citations=citations)
