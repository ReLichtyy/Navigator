from __future__ import annotations

from openai import OpenAI

from app.core.config import settings
from app.schemas.syllabus import Citation
from app.services.vector_store import get_chunks_collection

HistoryTurn = tuple[str, str]  # (role, content) where role is 'user' | 'ai'


def build_chroma_where(user_id: str, syllabus_id: str) -> dict:
    return {"$and": [{"user_id": user_id}, {"syllabus_id": syllabus_id}]}


def answer_question(
    user_id: str,
    syllabus_id: str,
    question: str,
    history: list[HistoryTurn] | None = None,
    model: str | None = None,
) -> tuple[str, list[Citation]]:
    """
    Retrieve chunks scoped to user + syllabus, then grounded LLM answer with citations.
    Optional conversation history enables multi-turn follow-ups.
    """
    if not settings.openai_api_key:
        raise ValueError("OPENAI_API_KEY is not configured")

    chat_model = model or settings.chat_model
    if chat_model not in settings.chat_models_list:
        chat_model = settings.chat_model

    client = OpenAI(api_key=settings.openai_api_key)
    col = get_chunks_collection()

    qemb_resp = client.embeddings.create(model=settings.embedding_model, input=[question])
    query_embedding = qemb_resp.data[0].embedding

    where_clause = build_chroma_where(user_id, syllabus_id)
    result = col.query(
        query_embeddings=[query_embedding],
        n_results=8,
        where=where_clause,
        include=["documents", "metadatas", "distances"],
    )

    documents = (result.get("documents") or [[]])[0]
    metadatas = (result.get("metadatas") or [[]])[0]
    ids_out = (result.get("ids") or [[]])[0]

    context_parts: list[str] = []
    citations: list[Citation] = []

    for i, doc in enumerate(documents):
        if not doc:
            continue
        meta = metadatas[i] if i < len(metadatas) else {}
        chunk_id = ids_out[i] if i < len(ids_out) else f"unknown_{i}"
        quote = doc[:500] + ("..." if len(doc) > 500 else "")
        ps = meta.get("page_start")
        pe = meta.get("page_end")
        citations.append(
            Citation(
                chunk_id=str(chunk_id),
                page_start=int(ps) if ps is not None else None,
                page_end=int(pe) if pe is not None else None,
                quote=quote,
            )
        )
        context_parts.append(f"[Fragment {i + 1}]\n{doc}")

    if not context_parts:
        return (
            "No consta en tus archivos subidos: no encontré fragmentos relevantes en este sílabo.",
            [],
        )

    context = "\n\n".join(context_parts)
    system = (
        "Eres un asistente académico. Responde usando únicamente el contexto proporcionado. "
        "Si la respuesta no está en el contexto, indica claramente que no consta en el documento. "
        "No inventes fechas, porcentajes ni políticas de evaluación. "
        "Cuando uses información de un fragmento, menciona su etiqueta, por ejemplo [Fragment 1]. "
        "Puedes usar el historial de conversación para entender referencias como 'eso' o 'el examen'."
    )

    messages: list[dict[str, str]] = [{"role": "system", "content": system}]

    for role, content in history or []:
        openai_role = "assistant" if role == "ai" else "user"
        messages.append({"role": openai_role, "content": content})

    messages.append(
        {
            "role": "user",
            "content": f"Contexto del sílabo:\n{context}\n\nPregunta: {question}",
        }
    )

    completion = client.chat.completions.create(
        model=chat_model,
        messages=messages,
        temperature=0.2,
    )
    answer = completion.choices[0].message.content or ""
    return answer, citations[:5]
