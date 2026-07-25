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

  /**
   * Phase 2 (worker): write many embeddings in one round-trip per slice via a
   * single `UPDATE ... FROM (VALUES ...)`. Replaces the per-chunk UPDATE loop,
   * which cost one serverless DB round-trip per chunk. Sliced to stay well under
   * Postgres' parameter cap (2 params/row).
   */
  async setEmbeddings(items: { id: string; embedding: number[] }[]): Promise<number> {
    if (items.length === 0) return 0
    const SLICE = 500
    for (let i = 0; i < items.length; i += SLICE) {
      const slice = items.slice(i, i + SLICE)
      const values: string[] = []
      const params: unknown[] = []
      let p = 1
      for (const it of slice) {
        values.push(`($${p++}::uuid, $${p++}::vector)`)
        params.push(it.id, toVectorLiteral(it.embedding))
      }
      const text = `
        UPDATE chunks AS c
        SET embedding = v.embedding
        FROM (VALUES ${values.join(", ")}) AS v(id, embedding)
        WHERE c.id = v.id
      `
      await sql.query(text, params)
    }
    return items.length
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

  /**
   * Full text of EVERY processed document in a course the user owns, grouped per
   * document (filename header + ordered chunks). Used to generate the whole-course
   * study set. Ownership-scoped via syllabus_uploads.user_id.
   */
  async getConcatenatedTextByCourse(userId: string, courseId: string): Promise<string> {
    const rows = await sql`
      SELECT su.original_filename, c.content
      FROM chunks c
      JOIN syllabus_uploads su ON su.id = c.syllabus_id
      WHERE su.course_id = ${courseId}::uuid AND su.user_id = ${userId}
      ORDER BY su.original_filename ASC, c.chunk_index ASC
    `
    const docs = rows as { original_filename: string; content: string }[]
    // Prefix each document's text with its name so cross-document questions can
    // attribute concepts to the right PDF.
    const byDoc = new Map<string, string[]>()
    for (const r of docs) {
      const arr = byDoc.get(r.original_filename) ?? []
      arr.push(r.content)
      byDoc.set(r.original_filename, arr)
    }
    return [...byDoc.entries()]
      .map(
        ([name, parts]) =>
          `## ${name.replace(/\.(pdf|docx|pptx|xlsx)$/i, "")}\n\n${parts.join("\n\n")}`,
      )
      .join("\n\n")
  },

  /**
   * Full text of a user-selected SUBSET of a course's documents, grouped per
   * document (filename header + ordered chunks) like getConcatenatedTextByCourse.
   * Used to generate the whole-course mind map from the docs picked in the
   * "Editar mapa" drawer. Ownership + course membership enforced in SQL.
   */
  async getConcatenatedTextByDocs(
    userId: string,
    courseId: string,
    docIds: string[],
  ): Promise<string> {
    if (docIds.length === 0) return ""
    const rows = await sql`
      SELECT su.original_filename, c.content
      FROM chunks c
      JOIN syllabus_uploads su ON su.id = c.syllabus_id
      WHERE su.course_id = ${courseId}::uuid AND su.user_id = ${userId}
        AND su.id = ANY(${docIds}::uuid[])
      ORDER BY su.original_filename ASC, c.chunk_index ASC
    `
    const docs = rows as { original_filename: string; content: string }[]
    const byDoc = new Map<string, string[]>()
    for (const r of docs) {
      const arr = byDoc.get(r.original_filename) ?? []
      arr.push(r.content)
      byDoc.set(r.original_filename, arr)
    }
    return [...byDoc.entries()]
      .map(
        ([name, parts]) =>
          `## ${name.replace(/\.(pdf|docx|pptx|xlsx)$/i, "")}\n\n${parts.join("\n\n")}`,
      )
      .join("\n\n")
  },

  /**
   * Cheap content fingerprint for a syllabus — changes whenever its chunks change
   * (re-upload / edit). Used to invalidate the versioned study-set cache without
   * hashing the full text. Returns "" when the syllabus has no chunks.
   */
  async contentFingerprint(syllabusId: string): Promise<string> {
    const rows = await sql`
      SELECT count(c.id)::int AS n,
             COALESCE(max(c.created_at)::text, '') AS chunk_ts,
             COALESCE(su.graph_generated_at::text, '') AS graph_ts,
             COALESCE(su.graph_status, '') AS graph_status
      FROM syllabus_uploads su
      LEFT JOIN chunks c ON c.syllabus_id = su.id
      WHERE su.id = ${syllabusId}::uuid
      GROUP BY su.id, su.graph_generated_at, su.graph_status
    `
    const r = (rows[0] as
      | { n: number; chunk_ts: string; graph_ts: string; graph_status: string }
      | undefined) ?? { n: 0, chunk_ts: "", graph_ts: "", graph_status: "" }
    return `${r.n}:${r.chunk_ts}:${r.graph_ts}:${r.graph_status}`
  },

  /** Same as contentFingerprint, aggregated over every document in a course. */
  async contentFingerprintByCourse(userId: string, courseId: string): Promise<string> {
    const rows = await sql`
      SELECT count(c.id)::int AS n,
             COALESCE(max(c.created_at)::text, '') AS chunk_ts,
             COALESCE(max(su.graph_generated_at)::text, '') AS doc_graph_ts,
             COALESCE(string_agg(DISTINCT su.id::text, ',' ORDER BY su.id::text), '') AS docs,
             COALESCE(cg.updated_at::text, '') AS course_graph_ts,
             COALESCE(cg.status, '') AS course_graph_status
      FROM syllabus_uploads su
      LEFT JOIN chunks c ON c.syllabus_id = su.id
      LEFT JOIN course_graphs cg ON cg.course_id = su.course_id
      WHERE su.course_id = ${courseId}::uuid AND su.user_id = ${userId}
      GROUP BY cg.updated_at, cg.status
    `
    const r = (rows[0] as
      | {
          n: number
          chunk_ts: string
          doc_graph_ts: string
          docs: string
          course_graph_ts: string
          course_graph_status: string
        }
      | undefined) ?? {
      n: 0,
      chunk_ts: "",
      doc_graph_ts: "",
      docs: "",
      course_graph_ts: "",
      course_graph_status: "",
    }
    return [r.n, r.chunk_ts, r.doc_graph_ts, r.docs, r.course_graph_ts, r.course_graph_status].join(
      ":",
    )
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
   * Step 2 (hybrid): lexical (full-text) candidates for a syllabus via the GIN
   * tsvector index — catches exact terms / formulas / names the embedding misses.
   * Ordered by ts_rank. Also computes the vector `distance` for each hit so these
   * candidates are first-class for the existing relevance gate + hybrid re-rank.
   */
  async searchLexical(
    syllabusId: string,
    query: string,
    queryEmbedding: number[],
    limit = 24,
  ): Promise<RetrievedChunk[]> {
    const qvec = toVectorLiteral(queryEmbedding)
    const rows = await sql`
      SELECT c.id, c.chunk_index, c.content, c.page_start, c.page_end, c.char_start, c.char_end,
             c.syllabus_id, su.original_filename AS source_name,
             su.source_type, su.source_url, su.file_url,
             c.embedding <=> ${qvec}::vector AS distance
      FROM chunks c
      JOIN syllabus_uploads su ON su.id = c.syllabus_id
      WHERE c.syllabus_id = ${syllabusId}::uuid
        AND (
          c.ts @@ plainto_tsquery('spanish', ${query})
          OR c.ts_simple @@ plainto_tsquery('simple', ${query})
        )
      ORDER BY GREATEST(
        ts_rank(c.ts, plainto_tsquery('spanish', ${query})),
        ts_rank(c.ts_simple, plainto_tsquery('simple', ${query}))
      ) DESC
      LIMIT ${limit}
    `
    return rows as RetrievedChunk[]
  },

  /** Step 2 (hybrid): dense candidates scoped to every document in a course. */
  async searchByCourse(
    userId: string,
    courseId: string,
    queryEmbedding: number[],
    limit = 8,
    docIds?: string[],
  ): Promise<RetrievedChunk[]> {
    const qvec = toVectorLiteral(queryEmbedding)
    const rows = await sql`
      SELECT c.id, c.chunk_index, c.content, c.page_start, c.page_end, c.char_start, c.char_end,
             c.syllabus_id, su.original_filename AS source_name,
             su.source_type, su.source_url, su.file_url,
             c.embedding <=> ${qvec}::vector AS distance
      FROM chunks c
      JOIN syllabus_uploads su ON su.id = c.syllabus_id
      WHERE su.course_id = ${courseId}::uuid AND su.user_id = ${userId} AND c.embedding IS NOT NULL
        AND (${docIds ?? null}::uuid[] IS NULL OR su.id = ANY(${docIds ?? null}::uuid[]))
      ORDER BY distance ASC
      LIMIT ${limit}
    `
    return rows as RetrievedChunk[]
  },

  /** Step 2 (hybrid): lexical candidates scoped to every document in a course. */
  async searchLexicalByCourse(
    userId: string,
    courseId: string,
    query: string,
    queryEmbedding: number[],
    limit = 24,
  ): Promise<RetrievedChunk[]> {
    const qvec = toVectorLiteral(queryEmbedding)
    const rows = await sql`
      SELECT c.id, c.chunk_index, c.content, c.page_start, c.page_end, c.char_start, c.char_end,
             c.syllabus_id, su.original_filename AS source_name,
             su.source_type, su.source_url, su.file_url,
             c.embedding <=> ${qvec}::vector AS distance
      FROM chunks c
      JOIN syllabus_uploads su ON su.id = c.syllabus_id
      WHERE su.course_id = ${courseId}::uuid AND su.user_id = ${userId}
        AND (
          c.ts @@ plainto_tsquery('spanish', ${query})
          OR c.ts_simple @@ plainto_tsquery('simple', ${query})
        )
      ORDER BY GREATEST(
        ts_rank(c.ts, plainto_tsquery('spanish', ${query})),
        ts_rank(c.ts_simple, plainto_tsquery('simple', ${query}))
      ) DESC
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
