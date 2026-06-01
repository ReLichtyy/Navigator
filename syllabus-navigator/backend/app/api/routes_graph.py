import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.graph import Topic, TopicDependency
from app.models.syllabus_upload import SyllabusUpload
from app.schemas.syllabus import GraphEdge, GraphNode, GraphResponse
from app.services.vector_store import get_chunks_collection
from app.services.ingestor import generate_and_persist_graph_task

router = APIRouter()


def _require_user(x_user_id: str | None) -> str:
    if not x_user_id or not x_user_id.strip():
        raise HTTPException(status_code=400, detail="Missing or empty X-User-Id header")
    return x_user_id.strip()


def _get_upload_for_user(
    db: Session, syllabus_id: str, user_id: str
) -> SyllabusUpload:
    try:
        syllabus_uuid = uuid.UUID(syllabus_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid syllabus ID format")

    upload = db.scalar(
        select(SyllabusUpload).where(SyllabusUpload.id == syllabus_uuid)
    )
    if not upload:
        raise HTTPException(status_code=404, detail="Syllabus upload not found")
    if upload.user_id != user_id:
        raise HTTPException(status_code=403, detail="Syllabus not found for this user")
    return upload


def _sorted_syllabus_text(col, syllabus_id: str) -> str:
    existing = col.get(where={"syllabus_id": syllabus_id}, include=["documents", "metadatas"])
    documents = existing.get("documents") or []
    metadatas = existing.get("metadatas") or []
    if not documents:
        raise ValueError("No text documents found in vector store for this syllabus")

    pairs: list[tuple[int, str]] = []
    for i, doc in enumerate(documents):
        if not doc:
            continue
        meta = metadatas[i] if i < len(metadatas) else {}
        idx = int(meta.get("chunk_index", i))
        pairs.append((idx, doc))
    pairs.sort(key=lambda x: x[0])
    return "\n\n".join(doc for _, doc in pairs)


@router.get("/{syllabus_id}", response_model=GraphResponse)
def get_graph(
    syllabus_id: str,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> GraphResponse:
    user_id = _require_user(x_user_id)
    upload = _get_upload_for_user(db, syllabus_id, user_id)

    if upload.graph_status != "ready":
        return GraphResponse(
            syllabus_id=syllabus_id,
            graph_status=upload.graph_status,
            graph_error=upload.graph_error,
            nodes=[],
            edges=[],
        )

    try:
        topics = db.scalars(
            select(Topic).where(Topic.syllabus_id == upload.id)
        ).all()

        dependencies = db.scalars(
            select(TopicDependency).where(TopicDependency.syllabus_id == upload.id)
        ).all()

        nodes = [
            GraphNode(
                id=str(t.id),
                label=t.label,
                weight_percent=float(t.weight_percent) if t.weight_percent is not None else 0.0,
            )
            for t in topics
        ]

        edges = [
            GraphEdge(
                source=str(d.prerequisite_topic_id),
                target=str(d.target_topic_id),
            )
            for d in dependencies
        ]

        return GraphResponse(
            syllabus_id=syllabus_id,
            graph_status=upload.graph_status,
            graph_error=upload.graph_error,
            nodes=nodes,
            edges=edges,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch graph from database: {str(e)}")


@router.post("/{syllabus_id}/reprocess", response_model=GraphResponse)
def reprocess_graph(
    syllabus_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> GraphResponse:
    user_id = _require_user(x_user_id)
    upload = _get_upload_for_user(db, syllabus_id, user_id)

    try:
        col = get_chunks_collection()
        syllabus_text = _sorted_syllabus_text(col, syllabus_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to retrieve syllabus text: {str(e)}")

    upload.graph_status = "processing"
    upload.graph_error = None
    upload.updated_at = datetime.now(timezone.utc)
    db.commit()

    background_tasks.add_task(generate_and_persist_graph_task, upload.id, syllabus_text)

    return GraphResponse(
        syllabus_id=syllabus_id,
        graph_status="processing",
        graph_error=None,
        nodes=[],
        edges=[],
    )
