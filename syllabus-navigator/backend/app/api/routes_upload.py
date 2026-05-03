from fastapi import APIRouter, UploadFile

from app.schemas.syllabus import UploadResponse
from app.services.ingestor import ingest_syllabus


router = APIRouter()


@router.post("/syllabus", response_model=UploadResponse)
async def upload_syllabus(file: UploadFile) -> UploadResponse:
    syllabus_id = ingest_syllabus(file.filename or "unknown-file")
    return UploadResponse(
        syllabus_id=syllabus_id,
        message="Syllabus uploaded and queued for processing.",
    )
