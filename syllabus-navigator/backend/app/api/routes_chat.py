from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.syllabus_upload import SyllabusUpload
from app.schemas.syllabus import ChatQuery, ChatResponse
from app.services.rag_engine import answer_question

router = APIRouter()


@router.post("/query", response_model=ChatResponse)
def query_syllabus(
    payload: ChatQuery,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> ChatResponse:
    if not x_user_id or not x_user_id.strip():
        raise HTTPException(status_code=400, detail="Missing or empty X-User-Id header")
    user_id = x_user_id.strip()

    try:
        sid = UUID(payload.syllabus_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid syllabus_id") from e

    row = db.get(SyllabusUpload, sid)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="Syllabus not found for this user")
    if row.status != "ready":
        raise HTTPException(
            status_code=409,
            detail=f"Syllabus is not ready for queries (status={row.status})",
        )

    try:
        answer, citations = answer_question(user_id, str(sid), payload.question)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query failed: {e!s}") from e

    return ChatResponse(answer=answer, citations=citations)
