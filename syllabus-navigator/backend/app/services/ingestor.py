from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone

from fastapi import BackgroundTasks
from openai import OpenAI
from sqlalchemy import select, delete, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.syllabus_upload import SyllabusUpload
from app.models.graph import Topic, TopicDependency
from app.services.graph_gen import extract_graph_from_text
from app.services.vector_store import delete_chunks_for_syllabus, get_chunks_collection
from app.utils.chunking import pdf_bytes_to_page_chunks


def generate_and_persist_graph_task(syllabus_id: uuid.UUID, syllabus_text: str) -> None:
    """
    Background task to generate, validate, and persist the knowledge graph in PostgreSQL.
    Updates the syllabus upload status to 'ready' or 'failed' accordingly.
    """
    db: Session = SessionLocal()
    try:
        from decimal import Decimal
        graph = extract_graph_from_text(syllabus_text, str(syllabus_id))

        with db.begin():
            # Idempotency: Clean up any old topics and dependencies for this syllabus
            db.execute(delete(TopicDependency).where(TopicDependency.syllabus_id == syllabus_id))
            db.execute(delete(Topic).where(Topic.syllabus_id == syllabus_id))

            external_to_uuid_map = {}
            for node in graph.nodes:
                topic_uuid = uuid.uuid4()
                new_topic = Topic(
                    id=topic_uuid,
                    syllabus_id=syllabus_id,
                    external_id=node.id,
                    label=node.label,
                    description=None,
                    weight_percent=Decimal(str(node.weight)) if node.weight is not None else None,
                    created_at=datetime.now(timezone.utc)
                )
                db.add(new_topic)
                external_to_uuid_map[node.id] = topic_uuid

            db.flush()  # Push topics to DB to ensure IDs are active

            for node in graph.nodes:
                target_uuid = external_to_uuid_map[node.id]
                for dep_external_id in node.dependencies:
                    if dep_external_id in external_to_uuid_map:
                        prereq_uuid = external_to_uuid_map[dep_external_id]
                        new_dep = TopicDependency(
                            id=uuid.uuid4(),
                            syllabus_id=syllabus_id,
                            prerequisite_topic_id=prereq_uuid,
                            target_topic_id=target_uuid,
                            relation_type="prerequisite",
                            confidence=Decimal("1.000"),
                            created_at=datetime.now(timezone.utc)
                        )
                        db.add(new_dep)

            # Update the syllabus upload graph status
            db.execute(
                update(SyllabusUpload)
                .where(SyllabusUpload.id == syllabus_id)
                .values(
                    graph_status="ready",
                    graph_error=None,
                    graph_generated_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc)
                )
            )
    except Exception as exc:
        db.rollback()
        with SessionLocal() as err_db:
            err_db.execute(
                update(SyllabusUpload)
                .where(SyllabusUpload.id == syllabus_id)
                .values(
                    graph_status="failed",
                    graph_error=str(exc)[:2000],
                    updated_at=datetime.now(timezone.utc)
                )
            )
            err_db.commit()
    finally:
        db.close()


def ingest_syllabus_pdf(
    db: Session,
    user_id: str,
    filename: str,
    pdf_bytes: bytes,
    background_tasks: BackgroundTasks | None = None
) -> str:
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
        row.graph_status = "pending"
        row.graph_error = None
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
            graph_status="pending",
            graph_error=None,
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
        row.graph_status = "processing"
        row.graph_error = None
        row.updated_at = datetime.now(timezone.utc)
        db.commit()

        syllabus_text = "\n\n".join(texts)
        if background_tasks is not None:
            background_tasks.add_task(generate_and_persist_graph_task, row.id, syllabus_text)
        else:
            # Fallback to sync if no background tasks provided (e.g. tests or scripts)
            generate_and_persist_graph_task(row.id, syllabus_text)

        return syllabus_id_str
    except Exception as exc:
        row.status = "failed"
        row.error_message = str(exc)[:2000]
        row.graph_status = "failed"
        row.graph_error = f"Ingestion failed: {exc!s}"
        row.updated_at = datetime.now(timezone.utc)
        db.commit()
        raise

