from pydantic import BaseModel, Field


class UploadResponse(BaseModel):
    syllabus_id: str
    message: str


class ChatQuery(BaseModel):
    syllabus_id: str = Field(min_length=1)
    question: str = Field(min_length=3)


class Citation(BaseModel):
    chunk_id: str
    page_start: int | None = None
    page_end: int | None = None
    quote: str


class ChatResponse(BaseModel):
    answer: str
    citations: list[Citation]


class GraphNode(BaseModel):
    id: str
    label: str
    weight_percent: float | None = None


class GraphEdge(BaseModel):
    source: str
    target: str


class GraphResponse(BaseModel):
    syllabus_id: str
    graph_status: str
    graph_error: str | None = None
    nodes: list[GraphNode]
    edges: list[GraphEdge]

