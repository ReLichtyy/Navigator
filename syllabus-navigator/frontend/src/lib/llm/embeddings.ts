/**
 * llm/embeddings.ts — text embeddings via OpenAI.
 *
 * Used by the RAG pipeline (ingestion + retrieval). Kept separate from the chat
 * provider layer: embeddings only need OpenAI, batched.
 */

import OpenAI from "openai"
import { logError } from "@/lib/observability/logger"

export const EMBEDDING_MODEL = "text-embedding-3-large"
export const EMBEDDING_DIM = 2000 // truncated via Matryoshka; pgvector HNSW caps at 2000
const BATCH_SIZE = 96

let _client: OpenAI | null = null

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")
    _client = new OpenAI({ apiKey })
  }
  return _client
}

/** Embed many texts, batched. Returns one vector per input, in order. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const client = getClient()
  const out: number[][] = []

  try {
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE)
      const resp = await client.embeddings.create({ model: EMBEDDING_MODEL, input: batch, dimensions: EMBEDDING_DIM })
      // OpenAI does not contractually guarantee `data` order matches `input`; each
      // item carries an `index`. Sort by it so every embedding maps to the right
      // chunk — otherwise retrieval silently cites the wrong text (BUG-002).
      const ordered = resp.data.slice().sort((a, b) => a.index - b.index)
      for (const d of ordered) out.push(d.embedding)
    }
    return out
  } catch (err) {
    logError("llm.embeddings.error", { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

/** Embed a single text. */
export async function embedText(text: string): Promise<number[]> {
  const [vec] = await embedTexts([text])
  return vec
}

/** Serialize a vector to the literal pgvector accepts: "[0.1,0.2,...]". */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`
}
