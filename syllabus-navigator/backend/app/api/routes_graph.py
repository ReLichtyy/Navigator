import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.graph import Topic, TopicDependency
from app.models.syllabus_upload import SyllabusUpload
from app.schemas.syllabus import GraphEdge, GraphNode, GraphResponse
from app.services.vector_store import get_chunks_collection
from app.services.ingestor import generate_and_persist_graph_task

router = APIRouter()


@router.get("/{syllabus_id}", response_model=GraphResponse)
def get_graph(syllabus_id: str, db: Session = Depends(get_db)) -> GraphResponse:
    try:
        syllabus_uuid = uuid.UUID(syllabus_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid syllabus ID format")

    # Verify if the syllabus upload exists
    upload = db.scalar(select(SyllabusUpload).where(SyllabusUpload.id == syllabus_uuid))
    if not upload:
        raise HTTPException(status_code=404, detail="Syllabus upload not found")

    if upload.graph_status != "ready":
        return GraphResponse(
            syllabus_id=syllabus_id,
            graph_status=upload.graph_status,
            graph_error=upload.graph_error,
            nodes=[],
            edges=[]
        )

    try:
        # Query topics (nodes) from PostgreSQL
        topics = db.scalars(
            select(Topic).where(Topic.syllabus_id == syllabus_uuid)
        ).all()

        # Query dependencies (edges) from PostgreSQL
        dependencies = db.scalars(
            select(TopicDependency).where(TopicDependency.syllabus_id == syllabus_uuid)
        ).all()

        nodes = []
        for t in topics:
            nodes.append(
                GraphNode(
                    id=str(t.id),
                    label=t.label,
                    weight_percent=float(t.weight_percent) if t.weight_percent is not None else 0.0,
                )
            )

        edges = []
        for d in dependencies:
            edges.append(
                GraphEdge(
                    source=str(d.prerequisite_topic_id),
                    target=str(d.target_topic_id),
                )
            )

        return GraphResponse(
            syllabus_id=syllabus_id,
            graph_status=upload.graph_status,
            graph_error=upload.graph_error,
            nodes=nodes,
            edges=edges
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch graph from database: {str(e)}")


@router.post("/{syllabus_id}/reprocess", response_model=GraphResponse)
def reprocess_graph(
    syllabus_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
) -> GraphResponse:
    try:
        syllabus_uuid = uuid.UUID(syllabus_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid syllabus ID format")

    upload = db.scalar(select(SyllabusUpload).where(SyllabusUpload.id == syllabus_uuid))
    if not upload:
        raise HTTPException(status_code=404, detail="Syllabus upload not found")

    # Fetch document texts from ChromaDB to reconstruct the syllabus text
    try:
        col = get_chunks_collection()
        existing = col.get(where={"syllabus_id": syllabus_id})
        documents = existing.get("documents") or []
        if not documents:
            raise ValueError("No text documents found in vector store for this syllabus")
        syllabus_text = "\n\n".join(documents)
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
        edges=[]
    )

