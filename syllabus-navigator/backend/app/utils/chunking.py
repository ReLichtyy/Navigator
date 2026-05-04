def split_text(text: str, max_len: int = 1200, overlap: int = 120) -> list[str]:
    """Split long text into overlapping windows for embedding."""
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_len:
        return [text]
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + max_len, len(text))
        chunks.append(text[start:end])
        if end == len(text):
            break
        start = max(0, end - overlap)
    return chunks


def pdf_bytes_to_page_chunks(pdf_bytes: bytes, max_len: int = 1200, overlap: int = 120) -> list[dict]:
    """Extract text per page and split into chunk dicts with page numbers (1-based)."""
    import fitz

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    out: list[dict] = []
    try:
        for page_index in range(len(doc)):
            page = doc[page_index]
            raw = (page.get_text() or "").strip()
            if not raw:
                continue
            page_num = page_index + 1
            for piece in split_text(raw, max_len=max_len, overlap=overlap):
                out.append({"text": piece, "page_start": page_num, "page_end": page_num})
    finally:
        doc.close()
    return out
