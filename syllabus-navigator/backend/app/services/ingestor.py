from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone

from openai import OpenAI
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.syllabus_upload import SyllabusUpload
from app.services.vector_store import delete_chunks_for_syllabus, get_chunks_collection
from app.utils.chunking import pdf_bytes_to_page_chunks


def ingest_syllabus_pdf(db: Session, user_id: str, filename: str, pdf_bytes: bytes) -> str:
    """
    Store metadata in Postgres, chunk + embed PDF, upsert vectors in Chroma.
    Idempotent per (user_id, source_hash): returns existing id when already ready.
    """
    if not settings.openai_api_key:
        raise ValueError("OPENAI_API_KEY is not configured")

    source_hash = hashlib.sha256(pdf_bytes).hexdigest()
    now = datetime.now(timezone.utc)

    existing = db.scalars(
        select(SyllabusUpload).where(
            SyllabusUpload.user_id == user_id,
            SyllabusUpload.source_hash == source_hash,
        )
    ).first()

    if existing is not None and existing.status == "ready":
        return str(existing.id)

    if existing is not None:
        row = existing
        delete_chunks_for_syllabus(str(row.id))
        row.status = "processing"
        row.error_message = None
        row.original_filename = filename
        row.updated_at = now
        db.commit()
        db.refresh(row)
    else:
        row = SyllabusUpload(
            id=uuid.uuid4(),
            user_id=user_id,
            original_filename=filename,
            source_hash=source_hash,
            status="processing",
            error_message=None,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
        db.commit()
        db.refresh(row)

    syllabus_id_str = str(row.id)

    try:
        chunks_data = pdf_bytes_to_page_chunks(pdf_bytes)
        if not chunks_data:
            raise ValueError("No text could be extracted from this PDF")

        client = OpenAI(api_key=settings.openai_api_key)
        texts = [c["text"] for c in chunks_data]
        embeddings: list[list[float]] = []
        batch_size = 32
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            resp = client.embeddings.create(model=settings.embedding_model, input=batch)
            embeddings.extend([d.embedding for d in resp.data])

        col = get_chunks_collection()
        ids = [f"{syllabus_id_str}_{j}" for j in range(len(chunks_data))]
        metadatas: list[dict] = []
        for j, c in enumerate(chunks_data):
            metadatas.append(
                {
                    "user_id": user_id,
                    "syllabus_id": syllabus_id_str,
                    "chunk_index": j,
                    "page_start": int(c["page_start"]),
                    "page_end": int(c["page_end"]),
                    "source_filename": filename,
                }
            )

        col.add(ids=ids, embeddings=embeddings, documents=texts, metadatas=metadatas)

        row.status = "ready"
        row.error_message = None
        row.updated_at = datetime.now(timezone.utc)
        db.commit()
        return syllabus_id_str
    except Exception as exc:
        row.status = "failed"
        row.error_message = str(exc)[:2000]
        row.updated_at = datetime.now(timezone.utc)
        db.commit()
        raise
