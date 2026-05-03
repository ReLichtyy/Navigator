from pydantic import BaseModel, Field


class KnowledgeNode(BaseModel):
    id: str
    label: str
    dependencies: list[str] = Field(default_factory=list)
    weight: float


class SyllabusGraph(BaseModel):
    syllabus_id: str
    nodes: list[KnowledgeNode]


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
