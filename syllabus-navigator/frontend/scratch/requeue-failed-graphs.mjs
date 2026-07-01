// Re-enqueue ingest jobs for docs whose graph failed (e.g. missing BLUESMIND key
// at the time). The worker (cron/process or upload/[id]/process) will re-run the
// enrichment; embeddings are already done so it goes straight to graph/schedule.
import { config } from "dotenv"
config({ path: ".env.local" })
import { neon } from "@neondatabase/serverless"

const sql = neon(process.env.DATABASE_URL)

const failed = await sql`
  SELECT id, original_filename FROM syllabus_uploads WHERE graph_status = 'failed'`
console.log(`failed graphs: ${failed.length}`)

for (const doc of failed) {
  await sql`UPDATE syllabus_uploads SET graph_status = 'pending', graph_error = NULL WHERE id = ${doc.id}::uuid`
  await sql`
    INSERT INTO jobs (type, payload)
    VALUES ('ingest', ${JSON.stringify({ syllabusId: doc.id })}::jsonb)`
  console.log(`requeued: ${doc.original_filename}`)
}
console.log("done — now drain via POST /api/cron/process")
