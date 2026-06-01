from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, File, Header, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.syllabus_upload import SyllabusUpload
from app.schemas.chat_thread import SyllabusListResponse, SyllabusUploadOut
from app.schemas.syllabus import UploadResponse
from app.services.ingestor import ingest_syllabus_pdf

router = APIRouter()

MAX_UPLOAD_BYTES = 15 * 1024 * 1024


def _require_user(x_user_id: str | None) -> str:
    if not x_user_id or not x_user_id.strip():
        raise HTTPException(status_code=400, detail="Missing or empty X-User-Id header")
    return x_user_id.strip()


@router.get("/list", response_model=SyllabusListResponse)
def list_uploads(
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> SyllabusListResponse:
    user_id = _require_user(x_user_id)
    rows = db.scalars(
        select(SyllabusUpload)
        .where(SyllabusUpload.user_id == user_id)
        .order_by(SyllabusUpload.created_at.desc())
    ).all()
    return SyllabusListResponse(
        uploads=[
            SyllabusUploadOut(
                id=str(r.id),
                original_filename=r.original_filename,
                status=r.status,
                graph_status=r.graph_status,
                created_at=r.created_at,
            )
            for r in rows
        ]
    )


@router.post("/syllabus", response_model=UploadResponse)
async def upload_syllabus(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> UploadResponse:
    user_id = _require_user(x_user_id)

    filename = file.filename or "upload.pdf"
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported in the MVP")

    data = await file.read()
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 15MB)")

    try:
        syllabus_id = ingest_syllabus_pdf(db, user_id, filename, data, background_tasks)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ingest failed: {e!s}") from e

    return UploadResponse(
        syllabus_id=syllabus_id,
        message="Syllabus processed and indexed.",
    )
