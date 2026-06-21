/**
 * server/rag/chunking.ts — PDF text extraction + chunking.
 *
 * Port of backend/app/utils/chunking.py. Extracts text per page (1-based page
 * numbers) and splits into overlapping windows for embedding.
 */

import { extractText, getDocumentProxy } from "unpdf"

export interface TextChunk {
  text: string
  pageStart: number
  pageEnd: number
}

/** Split long text into overlapping windows. */
export function splitText(text: string, maxLen = 1200, overlap = 120): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.length <= maxLen) return [trimmed]

  const chunks: string[] = []
  let start = 0
  while (start < trimmed.length) {
    const end = Math.min(start + maxLen, trimmed.length)
    chunks.push(trimmed.slice(start, end))
    if (end === trimmed.length) break
    start = Math.max(0, end - overlap)
  }
  return chunks
}

/** Extract per-page text from a PDF and split into chunk dicts with page numbers. */
export async function pdfToPageChunks(
  pdfBytes: Uint8Array,
  maxLen = 1200,
  overlap = 120,
): Promise<TextChunk[]> {
  const pdf = await getDocumentProxy(pdfBytes)
  // mergePages: false → text per page, so we can attach page numbers to chunks.
  const { text: pages } = await extractText(pdf, { mergePages: false })

  const out: TextChunk[] = []
  pages.forEach((raw, idx) => {
    const pageText = (raw ?? "").trim()
    if (!pageText) return
    const pageNum = idx + 1
    for (const piece of splitText(pageText, maxLen, overlap)) {
      out.push({ text: piece, pageStart: pageNum, pageEnd: pageNum })
    }
  })
  return out
}
