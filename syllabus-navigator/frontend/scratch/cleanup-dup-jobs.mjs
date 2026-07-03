// One-off: mark duplicate pending/processing ingest jobs as superseded,
// keeping the oldest per syllabus. Run from syllabus-navigator/frontend.
// Usage: node scratch/cleanup-dup-jobs.mjs           (dry run: SELECT only)
//        node scratch/cleanup-dup-jobs.mjs --apply   (runs the UPDATE)
import { readFileSync } from "node:fs"
import { neon } from "@neondatabase/serverless"

const env = readFileSync(".env.local", "utf8")
const m = env.match(/^DATABASE_URL=(.+)$/m)
if (!m) throw new Error("no DATABASE_URL")
const sql = neon(m[1].trim().replace(/^"|"$/g, ""))

const dupes = await sql`
  SELECT id, status, created_at, payload->>'syllabusId' AS syllabus_id
  FROM (
    SELECT id, status, created_at, payload,
           row_number() OVER (
             PARTITION BY type, payload->>'syllabusId'
             ORDER BY created_at ASC
           ) AS rn
    FROM jobs
    WHERE type = 'ingest'
      AND status IN ('pending', 'processing')
  ) t
  WHERE rn > 1
  ORDER BY created_at ASC`

console.log(`=== duplicate ingest jobs (would be superseded): ${dupes.length} ===`)
for (const j of dupes) {
  console.log(j.created_at.toISOString(), j.status, "syllabus=" + j.syllabus_id, j.id)
}

if (!process.argv.includes("--apply")) {
  console.log("\nDry run. Re-run with --apply to mark these as superseded.")
  process.exit(0)
}

const updated = await sql`
  UPDATE jobs
  SET status = 'failed',
      error = 'superseded duplicate (cleanup 2026-07-02)',
      completed_at = now()
  WHERE id IN (
    SELECT id FROM (
      SELECT id,
             row_number() OVER (
               PARTITION BY type, payload->>'syllabusId'
               ORDER BY created_at ASC
             ) AS rn
      FROM jobs
      WHERE type = 'ingest'
        AND status IN ('pending', 'processing')
    ) t
    WHERE rn > 1
  )
  RETURNING id`
console.log(`\nSuperseded ${updated.length} duplicate job(s).`)
