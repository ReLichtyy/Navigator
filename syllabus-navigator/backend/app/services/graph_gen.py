from pydantic import BaseModel, Field


class KnowledgeNode(BaseModel):
    id: str
    label: str
    dependencies: list[str] = Field(default_factory=list)
    weight: float


class SyllabusGraph(BaseModel):
    syllabus_id: str
    nodes: list[KnowledgeNode]


import openai
import os
from openai import OpenAI

def extract_graph_from_text(syllabus_text: str, syllabus_id: str) -> SyllabusGraph:
    """Extracts topics and prerequisites from syllabus text using OpenAI."""
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    
    response = client.beta.chat.completions.parse(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You are an expert at extracting learning paths and prerequisite graphs from syllabus documents. Identify key topics, assign them an ID and label, and list their dependencies (other topic IDs). Avoid circular dependencies."},
            {"role": "user", "content": f"Extract the topic graph from the following syllabus text:\n\n{syllabus_text}"}
        ],
        response_format=SyllabusGraph,
        temperature=0.0
    )
    
    graph = response.choices[0].message.parsed
    graph.syllabus_id = syllabus_id
    validate_no_cycles(graph)
    return graph

def validate_no_cycles(graph: SyllabusGraph) -> bool:
    visited: set[str] = set()
    path: set[str] = set()
    lookup = {node.id: node for node in graph.nodes}

    def visit(node_id: str) -> bool:
        if node_id in path:
            return False
        if node_id in visited:
            return True

        path.add(node_id)
        node = lookup.get(node_id)
        if node:
            for dep in node.dependencies:
                if not visit(dep):
                    return False
        path.remove(node_id)
        visited.add(node_id)
        return True

    for node in graph.nodes:
        if not visit(node.id):
            raise ValueError(f"Cycle detected at node: {node.id}")
    return True
