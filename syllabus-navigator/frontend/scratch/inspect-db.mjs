// Read-only DB inspection: embedding dims, NULLs, job/upload errors.
import { config } from "dotenv"
config({ path: "C:/Users/Joshua/Desktop/PROYECTO/syllabus-navigator/frontend/.env.local" })
import { neon } from "@neondatabase/serverless"

const sql = neon(process.env.DATABASE_URL)

const colDim = await sql`
  SELECT c.relname AS tbl, a.attname, a.atttypmod AS dim, format_type(a.atttypid, a.atttypmod) AS type
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
  WHERE c.relname IN ('chunks','study_items') AND a.attname = 'embedding'`
console.log("column types:", JSON.stringify(colDim))

const chunkStats = await sql`
  SELECT count(*)::int AS total,
         count(embedding)::int AS embedded,
         (count(*) - count(embedding))::int AS null_embeddings
  FROM chunks`
console.log("chunks:", JSON.stringify(chunkStats))

const dims = await sql`SELECT DISTINCT vector_dims(embedding) AS d FROM chunks WHERE embedding IS NOT NULL`
console.log("chunk dims present:", JSON.stringify(dims))

const perDoc = await sql`
  SELECT su.id, su.original_filename, su.status, su.graph_status,
         count(c.id)::int AS chunks, count(c.embedding)::int AS embedded
  FROM syllabus_uploads su LEFT JOIN chunks c ON c.syllabus_id = su.id
  GROUP BY su.id, su.original_filename, su.status, su.graph_status
  ORDER BY max(su.created_at) DESC LIMIT 15`
console.log("recent docs:", JSON.stringify(perDoc, null, 1))

const itemStats = await sql`
  SELECT count(*)::int AS total, count(embedding)::int AS embedded FROM study_items`
console.log("study_items:", JSON.stringify(itemStats))
const itemDims = await sql`SELECT DISTINCT vector_dims(embedding) AS d FROM study_items WHERE embedding IS NOT NULL`
console.log("study_items dims:", JSON.stringify(itemDims))

const upErr = await sql`
  SELECT original_filename, status, error_message, graph_error, created_at
  FROM syllabus_uploads WHERE status = 'error' OR graph_status = 'failed'
  ORDER BY created_at DESC LIMIT 8`
console.log("upload/graph errors:", JSON.stringify(upErr, null, 1))

const idx = await sql`
  SELECT indexname FROM pg_indexes WHERE tablename IN ('chunks','study_items')`
console.log("indexes:", JSON.stringify(idx))
