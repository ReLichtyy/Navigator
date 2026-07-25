import crypto from "crypto"
import { sql } from "@/lib/db"
import type { TextChunk } from "../rag/chunking"

interface SourceBlockInsert {
  block_index: number
  block_type: "text" | "table" | "image" | "formula"
  content: string
  heading_path: string[]
  page_start: number | null
  page_end: number | null
  char_start: number | null
  char_end: number | null
  metadata: Record<string, unknown>
  content_hash: string
}

export interface SourceBlockRecord {
  id: string
  blockIndex: number
  content: string
  pageStart: number | null
  pageEnd: number | null
  charStart?: number | null
  charEnd?: number | null
}

export function sourceBlocksFromChunks(chunks: TextChunk[]): SourceBlockInsert[] {
  return chunks.map((chunk, index) => ({
    block_index: index,
    block_type: "text",
    content: chunk.text,
    heading_path: [],
    page_start: chunk.pageStart,
    page_end: chunk.pageEnd,
    char_start: chunk.charStart ?? null,
    char_end: chunk.charEnd ?? null,
    metadata: {},
    content_hash: crypto.createHash("sha256").update(chunk.text).digest("hex"),
  }))
}

export const SourceBlockRepository = {
  async fingerprint(syllabusId: string): Promise<string> {
    const rows = await sql`
      SELECT content_hash
      FROM source_blocks
      WHERE syllabus_id = ${syllabusId}::uuid
      ORDER BY block_index
    `
    return crypto
      .createHash("sha256")
      .update((rows as { content_hash: string }[]).map((row) => row.content_hash).join(":"))
      .digest("hex")
  },

  async list(syllabusId: string): Promise<SourceBlockRecord[]> {
    const rows = await sql`
      SELECT id, block_index, content, page_start, page_end, char_start, char_end
      FROM source_blocks
      WHERE syllabus_id = ${syllabusId}::uuid
      ORDER BY block_index
    `
    return (
      rows as {
        id: string
        block_index: number
        content: string
        page_start: number | null
        page_end: number | null
        char_start: number | null
        char_end: number | null
      }[]
    ).map((row) => ({
      id: row.id,
      blockIndex: row.block_index,
      content: row.content,
      pageStart: row.page_start,
      pageEnd: row.page_end,
      charStart: row.char_start,
      charEnd: row.char_end,
    }))
  },

  async replaceFromChunks(syllabusId: string, chunks: TextChunk[]): Promise<void> {
    const blocks = sourceBlocksFromChunks(chunks)
    await sql`DELETE FROM source_blocks WHERE syllabus_id = ${syllabusId}::uuid`
    await sql`
      UPDATE document_inventories
      SET status = 'processing', error = NULL, updated_at = now()
      WHERE syllabus_id = ${syllabusId}::uuid
    `
    if (blocks.length === 0) return
    await sql`
      INSERT INTO source_blocks
        (syllabus_id, block_index, block_type, content, heading_path,
         page_start, page_end, char_start, char_end, metadata, content_hash)
      SELECT
        ${syllabusId}::uuid, x.block_index, x.block_type, x.content,
        x.heading_path, x.page_start, x.page_end, x.char_start, x.char_end,
        x.metadata, x.content_hash
      FROM jsonb_to_recordset(${JSON.stringify(blocks)}::jsonb) AS x(
        block_index int,
        block_type text,
        content text,
        heading_path text[],
        page_start int,
        page_end int,
        char_start int,
        char_end int,
        metadata jsonb,
        content_hash text
      )
    `
  },
}
