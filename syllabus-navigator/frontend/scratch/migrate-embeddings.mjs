/**
 * migrate-embeddings.mjs — Migrate from text-embedding-3-small (1536) to
 * text-embedding-3-large (3072).
 *
 * pgvector requires dropping + recreating the column when changing dimension
 * (ALTER TYPE vector(N) rejects if existing non-NULL values have a different dim).
 * So: NULL first, then ALTER, then re-embed.
 *
 * Run: node scratch/migrate-embeddings.mjs
 */
import { config } from "dotenv"
config({ path: ".env.local" })

import { neon } from "@neondatabase/serverless"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const MODEL = "text-embedding-3-large"
const BATCH_SIZE = 96

if (!OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY not set")
  process.exit(1)
}

const sql = neon(process.env.DATABASE_URL)

async function embedBatch(texts) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, input: texts }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(`OpenAI API error ${res.status}: ${JSON.stringify(err.error)}`)
  }
  const data = await res.json()
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding)
}

function toVecLiteral(vec) {
  return `[${vec.join(",")}]`
}

console.log("=== Embedding Migration: 1536 → 3072 ===\n")

// Step 1: Drop HNSW indices (needed before column changes)
console.log("1. Dropping HNSW indices...")
try {
  await sql`DROP INDEX IF EXISTS idx_chunks_embedding`
  await sql`DROP INDEX IF EXISTS idx_study_items_embedding`
  console.log("   ✅ Indices dropped")
} catch (err) {
  console.log(`   ⚠️  ${err.message}`)
}

// Step 2: Drop and recreate columns with new dimension
// pgvector ALTER TYPE doesn't work when the column has a fixed dimension that
// differs. The safest approach: drop column → add column with new dimension.
console.log("2. Replacing embedding columns (1536 → 3072)...")

// chunks
try {
  await sql`ALTER TABLE chunks DROP COLUMN IF EXISTS embedding`
  await sql`ALTER TABLE chunks ADD COLUMN embedding vector(3072)`
  console.log("   ✅ chunks.embedding → vector(3072)")
} catch (err) {
  console.log(`   ❌ chunks: ${err.message}`)
  process.exit(1)
}

// study_items
try {
  await sql`ALTER TABLE study_items DROP COLUMN IF EXISTS embedding`
  await sql`ALTER TABLE study_items ADD COLUMN embedding vector(3072)`
  console.log("   ✅ study_items.embedding → vector(3072)")
} catch (err) {
  console.log(`   ❌ study_items: ${err.message}`)
  process.exit(1)
}

// Step 3: Re-embed chunks
console.log("3. Re-embedding chunks with text-embedding-3-large...")
const allChunks = await sql`
  SELECT id, content FROM chunks ORDER BY syllabus_id, chunk_index
`
console.log(`   ${allChunks.length} chunks to embed`)

let embeddedCount = 0
for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
  const batch = allChunks.slice(i, i + BATCH_SIZE)
  const texts = batch.map((c) => c.content)
  const vectors = await embedBatch(texts)

  // Write back one-by-one (neon serverless HTTP mode)
  for (let j = 0; j < batch.length; j++) {
    const vec = toVecLiteral(vectors[j])
    await sql`UPDATE chunks SET embedding = ${vec}::vector WHERE id = ${batch[j].id}::uuid`
  }

  embeddedCount += batch.length
  const pct = ((embeddedCount / allChunks.length) * 100).toFixed(1)
  process.stdout.write(`\r   Progress: ${embeddedCount}/${allChunks.length} (${pct}%)`)
}
console.log(`\n   ✅ ${embeddedCount} chunks re-embedded`)

// Step 4: Re-embed study_items
console.log("4. Re-embedding study_items...")
const allItems = await sql`
  SELECT id, dedupe_text FROM study_items WHERE dedupe_text IS NOT NULL AND dedupe_text != ''
`
console.log(`   ${allItems.length} study_items to embed`)

let itemCount = 0
for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
  const batch = allItems.slice(i, i + BATCH_SIZE)
  const texts = batch.map((it) => it.dedupe_text)
  const vectors = await embedBatch(texts)

  for (let j = 0; j < batch.length; j++) {
    const vec = toVecLiteral(vectors[j])
    await sql`UPDATE study_items SET embedding = ${vec}::vector WHERE id = ${batch[j].id}::uuid`
  }

  itemCount += batch.length
  const pct = ((itemCount / allItems.length) * 100).toFixed(1)
  process.stdout.write(`\r   Progress: ${itemCount}/${allItems.length} (${pct}%)`)
}
if (allItems.length > 0) console.log()
console.log(`   ✅ ${itemCount} study_items re-embedded`)

// Step 5: Recreate HNSW indices
console.log("5. Recreating HNSW indices...")
try {
  await sql`CREATE INDEX idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops)`
  console.log("   ✅ idx_chunks_embedding created")
} catch (err) {
  console.log(`   ⚠️  chunks index: ${err.message}`)
}
try {
  await sql`CREATE INDEX idx_study_items_embedding ON study_items USING hnsw (embedding vector_cosine_ops)`
  console.log("   ✅ idx_study_items_embedding created")
} catch (err) {
  console.log(`   ⚠️  study_items index: ${err.message}`)
}

// Step 6: Verify
console.log("\n6. Verification...")
const verify = await sql`
  SELECT 
    count(*)::int AS total,
    count(*) FILTER (WHERE embedding IS NOT NULL)::int AS with_emb,
    count(*) FILTER (WHERE embedding IS NULL)::int AS without_emb
  FROM chunks
`
const v = verify[0]
console.log(`   Chunks: ${v.total} total, ${v.with_emb} embedded, ${v.without_emb} pending`)

const dimCheck = await sql`
  SELECT array_length(embedding::real[], 1) AS dim
  FROM chunks WHERE embedding IS NOT NULL LIMIT 1
`
if (dimCheck.length > 0) {
  console.log(`   Vector dimension: ${dimCheck[0].dim}`)
}

const verifyItems = await sql`
  SELECT 
    count(*)::int AS total,
    count(*) FILTER (WHERE embedding IS NOT NULL)::int AS with_emb
  FROM study_items
`
const vi = verifyItems[0]
console.log(`   Study items: ${vi.total} total, ${vi.with_emb} embedded`)

console.log("\n=== Migration complete ===")
