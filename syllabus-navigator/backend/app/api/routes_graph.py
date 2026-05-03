from fastapi import APIRouter

from app.schemas.syllabus import GraphEdge, GraphNode, GraphResponse


router = APIRouter()


@router.get("/{syllabus_id}", response_model=GraphResponse)
def get_graph(syllabus_id: str) -> GraphResponse:
    nodes = [
        GraphNode(id="T1", label="Fundamentos", weight_percent=20.0),
        GraphNode(id="T2", label="Modelos RAG", weight_percent=30.0),
    ]
    edges = [GraphEdge(source="T1", target="T2")]
    return GraphResponse(syllabus_id=syllabus_id, nodes=nodes, edges=edges)
