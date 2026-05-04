from functools import lru_cache

import chromadb
from chromadb.api.models.Collection import Collection
from chromadb.config import Settings as ChromaSettings

from app.core.config import settings

COLLECTION_NAME = "syllabus_chunks"


@lru_cache(maxsize=1)
def _client() -> chromadb.HttpClient:
    return chromadb.HttpClient(
        host=settings.chroma_host,
        port=settings.chroma_port,
        settings=ChromaSettings(anonymized_telemetry=False),
    )


def get_chunks_collection() -> Collection:
    return _client().get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )


def delete_chunks_for_syllabus(syllabus_id: str) -> None:
    col = get_chunks_collection()
    existing = col.get(where={"syllabus_id": syllabus_id})
    ids = existing.get("ids") or []
    if ids:
        col.delete(ids=ids)
