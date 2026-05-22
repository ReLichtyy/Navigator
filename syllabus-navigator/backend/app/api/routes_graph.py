import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.graph import Topic, TopicDependency
from app.models.syllabus_upload import SyllabusUpload
from app.schemas.syllabus import GraphEdge, GraphNode, GraphResponse

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

    if upload.status == "processing":
        raise HTTPException(status_code=202, detail="Syllabus graph is still processing")
    elif upload.status == "failed":
        raise HTTPException(status_code=500, detail=f"Syllabus upload failed: {upload.error_message}")

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

        return GraphResponse(syllabus_id=syllabus_id, nodes=nodes, edges=edges)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch graph from database: {str(e)}")
