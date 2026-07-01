// Stagger the pending ingest jobs 3 min apart and reset attempts (their earlier
// failures were a missing env var / gateway burst, not bad content).
import { config } from "dotenv"
config({ path: ".env.local" })
import { neon } from "@neondatabase/serverless"
const sql = neon(process.env.DATABASE_URL)

const rows = await sql`
  WITH pending AS (
    SELECT id, row_number() OVER (ORDER BY created_at) - 1 AS n
    FROM jobs WHERE type = 'ingest' AND status = 'pending'
  )
  UPDATE jobs j
  SET attempts = 0, scheduled_at = now() + (p.n * interval '3 minutes')
  FROM pending p WHERE j.id = p.id
  RETURNING j.id, j.scheduled_at`
console.log(JSON.stringify(rows, null, 1))
