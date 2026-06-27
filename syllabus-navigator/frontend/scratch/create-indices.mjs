/**
 * Create IVFFlat indices for 3072-dim vectors.
 * HNSW has a 2000-dim limit; IVFFlat supports any dimension.
 * lists ≈ sqrt(n): sqrt(631)≈25 for chunks, sqrt(455)≈22 for study_items.
 */
import { config } from "dotenv"
config({ path: ".env.local" })
import { neon } from "@neondatabase/serverless"

const sql = neon(process.env.DATABASE_URL)

console.log("Creating IVFFlat indices for vector(3072)...\n")

try {
  await sql`CREATE INDEX idx_chunks_embedding ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 25)`
  console.log("✅ idx_chunks_embedding (IVFFlat, lists=25) created")
} catch (e) {
  console.log(`⚠️  chunks: ${e.message}`)
}

try {
  await sql`CREATE INDEX idx_study_items_embedding ON study_items USING ivfflat (embedding vector_cosine_ops) WITH (lists = 22)`
  console.log("✅ idx_study_items_embedding (IVFFlat, lists=22) created")
} catch (e) {
  console.log(`⚠️  study_items: ${e.message}`)
}

console.log("\nDone.")
