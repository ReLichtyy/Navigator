from fastapi import APIRouter, HTTPException

from app.schemas.syllabus import GraphEdge, GraphNode, GraphResponse
from app.services.graph_gen import extract_graph_from_text
from app.services.vector_store import get_chunks_collection


router = APIRouter()


@router.get("/{syllabus_id}", response_model=GraphResponse)
def get_graph(syllabus_id: str) -> GraphResponse:
    col = get_chunks_collection()
    results = col.get(where={"syllabus_id": syllabus_id})
    if not results or not results["documents"]:
        raise HTTPException(status_code=404, detail="Syllabus not found or no text available")
    
    # Concatenate all chunks to pass to the LLM
    syllabus_text = "\n\n".join(results["documents"])
    
    try:
        graph = extract_graph_from_text(syllabus_text, syllabus_id)
        
        nodes = []
        edges = []
        for n in graph.nodes:
            nodes.append(GraphNode(id=n.id, label=n.label, weight_percent=n.weight))
            for dep in n.dependencies:
                edges.append(GraphEdge(source=dep, target=n.id))
                
        return GraphResponse(syllabus_id=syllabus_id, nodes=nodes, edges=edges)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate graph: {str(e)}")
