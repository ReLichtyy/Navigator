import { config } from "dotenv"
config({ path: ".env.local" })
import { neon } from "@neondatabase/serverless"
const sql = neon(process.env.DATABASE_URL)
const rows = await sql`
  SELECT original_filename, graph_error FROM syllabus_uploads
  WHERE graph_status = 'failed' ORDER BY created_at DESC`
for (const r of rows) console.log(`${r.original_filename}\n  → ${r.graph_error}\n`)
