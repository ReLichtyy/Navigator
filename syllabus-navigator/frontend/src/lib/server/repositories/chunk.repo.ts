import { sql } from "@/lib/db"
import { toVectorLiteral } from "@/lib/llm/embeddings"
import type { TextChunk } from "../rag/chunking"

export interface RetrievedChunk {
  id: string
  chunk_index: number
  content: string
  page_start: number | null
  page_end: number | null
  char_start: number | null
  char_end: number | null
  distance: number
  source_name?: string | null
  syllabus_id?: string | null
  source_type?: string | null
  source_url?: string | null
  file_url?: string | null
}

export interface PendingChunk {
  id: string
  content: string
}

export const ChunkRepository = {
  /**
   * Phase 1 (upload, sync): replace a syllabus' chunks with text only (no
   * embeddings yet). Cheap — no external calls. The worker fills embeddings later.
   */
  async replaceChunksText(syllabusId: string, chunks: TextChunk[]): Promise<number> {
    await sql`DELETE FROM chunks WHERE syllabus_id = ${syllabusId}::uuid`
    if (chunks.length === 0) return 0

    const values: string[] = []
    const params: unknown[] = []
    let p = 1
    chunks.forEach((c, i) => {
      values.push(`($${p++}::uuid, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`)
      params.push(
        syllabusId,
        i,
        c.text,
        c.pageStart ?? null,
        c.pageEnd ?? null,
        c.charStart ?? null,
        c.charEnd ?? null,
      )
    })

    const text = `
      INSERT INTO chunks (syllabus_id, chunk_index, content, page_start, page_end, char_start, char_end)
      VALUES ${values.join(", ")}
    `
    await sql.query(text, params)
    return chunks.length
  },

  /** Phase 2 (worker): chunks awaiting an embedding. */
  async listPendingEmbeddings(syllabusId: string): Promise<PendingChunk[]> {
    const rows = await sql`
      SELECT id, content FROM chunks
      WHERE syllabus_id = ${syllabusId}::uuid AND embedding IS NULL
      ORDER BY chunk_index ASC
    `
    return rows as PendingChunk[]
  },

  /** Phase 2 (worker): write a computed embedding back to its chunk. */
  async setEmbedding(chunkId: string, embedding: number[]): Promise<void> {
    const vec = toVectorLiteral(embedding)
    await sql`UPDATE chunks SET embedding = ${vec}::vector WHERE id = ${chunkId}::uuid`
  },

  /** Full text of a syllabus (ordered) — used for graph generation. */
  async getConcatenatedText(syllabusId: string): Promise<string> {
    const rows = await sql`
      SELECT content FROM chunks
      WHERE syllabus_id = ${syllabusId}::uuid
      ORDER BY chunk_index ASC
    `
    return (rows as { content: string }[]).map((r) => r.content).join("\n\n")
  },

  /** Retrieval: nearest chunks to a query embedding, scoped to one syllabus. */
  async search(syllabusId: string, queryEmbedding: number[], limit = 8): Promise<RetrievedChunk[]> {
    const qvec = toVectorLiteral(queryEmbedding)
    const rows = await sql`
      SELECT c.id, c.chunk_index, c.content, c.page_start, c.page_end, c.char_start, c.char_end,
             c.syllabus_id, su.original_filename AS source_name,
             su.source_type, su.source_url, su.file_url,
             c.embedding <=> ${qvec}::vector AS distance
      FROM chunks c
      JOIN syllabus_uploads su ON su.id = c.syllabus_id
      WHERE c.syllabus_id = ${syllabusId}::uuid AND c.embedding IS NOT NULL
      ORDER BY distance ASC
      LIMIT ${limit}
    `
    return rows as RetrievedChunk[]
  },

  /**
   * Retrieval across ALL of a user's processed syllabi (multi-course chat).
   * Returns the source document name so citations can show which course.
   */
  async searchByUser(
    userId: string,
    queryEmbedding: number[],
    limit = 8,
  ): Promise<RetrievedChunk[]> {
    const qvec = toVectorLiteral(queryEmbedding)
    const rows = await sql`
      SELECT c.id, c.chunk_index, c.content, c.page_start, c.page_end, c.char_start, c.char_end,
             c.syllabus_id, su.original_filename AS source_name,
             su.source_type, su.source_url, su.file_url,
             c.embedding <=> ${qvec}::vector AS distance
      FROM chunks c
      JOIN syllabus_uploads su ON su.id = c.syllabus_id
      WHERE su.user_id = ${userId} AND c.embedding IS NOT NULL
      ORDER BY distance ASC
      LIMIT ${limit}
    `
    return rows as RetrievedChunk[]
  },
}
