// Re-enqueue ingest for failed-graph docs that have NO pending/processing job
// (e.g. after the job exhausted retries during a gateway outage). Scheduled
// +30 min so the Vercel cron picks it up once the gateway recovers.
import { config } from "dotenv"
config({ path: ".env.local" })
import { neon } from "@neondatabase/serverless"
const sql = neon(process.env.DATABASE_URL)

const rows = await sql`
  INSERT INTO jobs (type, payload, scheduled_at)
  SELECT 'ingest', jsonb_build_object('syllabusId', su.id), now() + interval '30 minutes'
  FROM syllabus_uploads su
  WHERE su.graph_status = 'failed'
    AND NOT EXISTS (
      SELECT 1 FROM jobs j
      WHERE j.type = 'ingest' AND j.status IN ('pending','processing')
        AND j.payload->>'syllabusId' = su.id::text
    )
  RETURNING id, payload`
console.log(JSON.stringify(rows, null, 1))
const state = await sql`SELECT status, count(*)::int AS n FROM jobs WHERE type='ingest' GROUP BY status`
console.log("ingest jobs:", JSON.stringify(state))
