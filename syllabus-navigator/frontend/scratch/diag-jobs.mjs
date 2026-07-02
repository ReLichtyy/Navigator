// Run from syllabus-navigator/frontend (needs node_modules + .env.local there).
import { readFileSync } from "node:fs"
import { neon } from "@neondatabase/serverless"

const env = readFileSync(".env.local", "utf8")
const m = env.match(/^DATABASE_URL=(.+)$/m)
if (!m) throw new Error("no DATABASE_URL")
const sql = neon(m[1].trim().replace(/^"|"$/g, ""))

const jobs = await sql`
  SELECT id, status, attempts, max_attempts, error, created_at, started_at, completed_at, payload
  FROM jobs ORDER BY created_at DESC LIMIT 12`
console.log("=== jobs (recent) ===")
for (const j of jobs) {
  console.log(
    j.created_at.toISOString(), j.status, `att=${j.attempts}/${j.max_attempts}`,
    JSON.stringify(j.payload), j.error ? `ERR: ${String(j.error).slice(0, 160)}` : "",
  )
}

const docs = await sql`
  SELECT id, original_filename, status, graph_status, graph_error, created_at
  FROM syllabus_uploads ORDER BY created_at DESC LIMIT 12`
console.log("\n=== uploads ===")
for (const d of docs) {
  console.log(
    d.created_at.toISOString(), d.status, "graph=" + d.graph_status,
    d.original_filename, d.graph_error ? `GERR: ${String(d.graph_error).slice(0, 160)}` : "",
  )
}
