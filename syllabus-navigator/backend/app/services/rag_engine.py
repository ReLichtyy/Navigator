from app.schemas.syllabus import Citation


def answer_question(syllabus_id: str, question: str) -> tuple[str, list[Citation]]:
    """
    Stub for hybrid retrieval + generation.
    Replace with:
    - vector retrieval (semantic)
    - graph-aware reranking
    - grounded answer generation with mandatory citations
    """
    _ = (syllabus_id, question)
    answer = "Respuesta temporal: el motor RAG aun no esta conectado."
    citations = [
        Citation(
            chunk_id="placeholder-chunk-1",
            page_start=1,
            page_end=1,
            quote="Ejemplo de cita hasta conectar el retrieval real.",
        )
    ]
    return answer, citations
