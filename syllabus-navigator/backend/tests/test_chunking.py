from app.services.rag_engine import build_chroma_where
from app.utils.chunking import split_text


def test_split_text_short() -> None:
    assert split_text("hello") == ["hello"]


def test_split_text_long_overlap() -> None:
    text = "a" * 2500
    parts = split_text(text, max_len=1000, overlap=100)
    assert len(parts) >= 3
    assert all(len(p) <= 1000 for p in parts)


def test_build_chroma_where() -> None:
    w = build_chroma_where("user-1", "syllabus-uuid")
    assert w == {"$and": [{"user_id": "user-1"}, {"syllabus_id": "syllabus-uuid"}]}
