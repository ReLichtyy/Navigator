/**
 * migrate-embeddings-2000.mjs — Fix: re-migrate from vector(3072) to vector(2000).
 *
 * pgvector HNSW/IVFFlat indices cap at 2000 dims, so we use text-embedding-3-large
 * with the `dimensions: 2000` param (Matryoshka truncation). Still better quality
 * than text-embedding-3-small at 1536.
 *
 * Run: node scratch/migrate-embeddings-2000.mjs
 */
import { config } from "dotenv"
config({ path: ".env.local" })
import { neon } from "@neondatabase/serverless"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const MODEL = "text-embedding-3-large"
const DIMS = 2000
const BATCH_SIZE = 96

if (!OPENAI_API_KEY) { console.error("❌ OPENAI_API_KEY not set"); process.exit(1) }

const sql = neon(process.env.DATABASE_URL)

async function embedBatch(texts) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: texts, dimensions: DIMS }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(`OpenAI ${res.status}: ${JSON.stringify(err.error)}`)
  }
  const data = await res.json()
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding)
}

function toVec(vec) { return `[${vec.join(",")}]` }

console.log(`=== Re-migrate embeddings: 3072 → ${DIMS} ===\n`)

// Step 1: Drop old columns (currently vector(3072)), recreate as vector(2000)
console.log("1. Replacing columns to vector(2000)...")
await sql`ALTER TABLE chunks DROP COLUMN IF EXISTS embedding`
await sql.query("ALTER TABLE chunks ADD COLUMN embedding vector(2000)")
console.log("   ✅ chunks.embedding → vector(2000)")

await sql`ALTER TABLE study_items DROP COLUMN IF EXISTS embedding`
await sql.query("ALTER TABLE study_items ADD COLUMN embedding vector(2000)")
console.log("   ✅ study_items.embedding → vector(2000)")

// Step 2: Re-embed chunks
console.log("2. Re-embedding chunks...")
const allChunks = await sql`SELECT id, content FROM chunks ORDER BY syllabus_id, chunk_index`
console.log(`   ${allChunks.length} chunks`)

let n = 0
for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
  const batch = allChunks.slice(i, i + BATCH_SIZE)
  const vecs = await embedBatch(batch.map((c) => c.content))
  for (let j = 0; j < batch.length; j++) {
    const v = toVec(vecs[j])
    await sql`UPDATE chunks SET embedding = ${v}::vector WHERE id = ${batch[j].id}::uuid`
  }
  n += batch.length
  process.stdout.write(`\r   ${n}/${allChunks.length} (${((n / allChunks.length) * 100).toFixed(0)}%)`)
}
console.log(`\n   ✅ ${n} chunks done`)

// Step 3: Re-embed study_items
console.log("3. Re-embedding study_items...")
const items = await sql`SELECT id, dedupe_text FROM study_items WHERE dedupe_text IS NOT NULL AND dedupe_text != ''`
console.log(`   ${items.length} items`)

let m = 0
for (let i = 0; i < items.length; i += BATCH_SIZE) {
  const batch = items.slice(i, i + BATCH_SIZE)
  const vecs = await embedBatch(batch.map((it) => it.dedupe_text))
  for (let j = 0; j < batch.length; j++) {
    const v = toVec(vecs[j])
    await sql`UPDATE study_items SET embedding = ${v}::vector WHERE id = ${batch[j].id}::uuid`
  }
  m += batch.length
  process.stdout.write(`\r   ${m}/${items.length} (${((m / items.length) * 100).toFixed(0)}%)`)
}
if (items.length > 0) console.log()
console.log(`   ✅ ${m} items done`)

// Step 4: HNSW indices (now ≤2000 → should work)
console.log("4. Creating HNSW indices...")
try {
  await sql`CREATE INDEX idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops)`
  console.log("   ✅ idx_chunks_embedding (HNSW)")
} catch (e) { console.log(`   ❌ ${e.message}`) }
try {
  await sql`CREATE INDEX idx_study_items_embedding ON study_items USING hnsw (embedding vector_cosine_ops)`
  console.log("   ✅ idx_study_items_embedding (HNSW)")
} catch (e) { console.log(`   ❌ ${e.message}`) }

// Verify
console.log("\n5. Verification...")
const vc = await sql`SELECT count(*)::int AS t, count(*) FILTER (WHERE embedding IS NOT NULL)::int AS e FROM chunks`
console.log(`   Chunks: ${vc[0].t} total, ${vc[0].e} embedded`)
const dim = await sql`SELECT array_length(embedding::real[], 1) AS d FROM chunks WHERE embedding IS NOT NULL LIMIT 1`
if (dim.length > 0) console.log(`   Dim: ${dim[0].d}`)
const vi = await sql`SELECT count(*)::int AS t, count(*) FILTER (WHERE embedding IS NOT NULL)::int AS e FROM study_items`
console.log(`   Study items: ${vi[0].t} total, ${vi[0].e} embedded`)

console.log("\n=== Done ===")
