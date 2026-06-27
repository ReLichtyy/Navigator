/**
 * Quick diagnostic: test embedding pipeline end-to-end.
 * Run: node scratch/test-embeddings.mjs
 */
import { config } from "dotenv"
config({ path: ".env.local" })

import { neon } from "@neondatabase/serverless"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
console.log("=== Embedding Pipeline Diagnostic ===\n")
console.log(`OPENAI_API_KEY present: ${Boolean(OPENAI_API_KEY)}`)
console.log(`OPENAI_API_KEY prefix:  ${OPENAI_API_KEY?.slice(0, 12)}...`)
console.log()

// 1. Test OpenAI embeddings endpoint directly
console.log("1. Testing OpenAI embeddings endpoint (text-embedding-3-small)...")
try {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: "Hello world test embedding",
    }),
  })

  const data = await res.json()

  if (res.ok) {
    console.log(`   ✅ SUCCESS — status ${res.status}`)
    console.log(`   Model: ${data.model}`)
    console.log(`   Embedding dim: ${data.data?.[0]?.embedding?.length}`)
    console.log(`   Usage: ${JSON.stringify(data.usage)}`)
  } else {
    console.log(`   ❌ FAILED — status ${res.status}`)
    console.log(`   Error: ${JSON.stringify(data.error)}`)
  }
} catch (err) {
  console.log(`   ❌ NETWORK ERROR: ${err.message}`)
}

console.log()

// 2. Check DB connectivity + pending chunks
console.log("2. Checking DATABASE_URL...")
const sql = neon(process.env.DATABASE_URL)

try {
  const timeCheck = await sql`SELECT NOW() AS time`
  console.log(`   ✅ DB connected — server time: ${timeCheck[0].time}`)
} catch (err) {
  console.log(`   ❌ DB ERROR: ${err.message}`)
  process.exit(1)
}

console.log()

// 3. Check job queue status
console.log("3. Checking jobs table for recent ingest jobs...")
try {
  const jobs = await sql`
    SELECT id, status, type, attempts, max_attempts, error,
           created_at, started_at, completed_at
    FROM jobs
    WHERE type = 'ingest'
    ORDER BY created_at DESC
    LIMIT 10
  `
  if (jobs.length === 0) {
    console.log("   ⚠️  No ingest jobs found at all. Jobs might not be getting enqueued.")
  } else {
    console.log(`   Found ${jobs.length} recent ingest jobs:`)
    for (const j of jobs) {
      const idShort = j.id.slice(0, 8)
      console.log(`   [${j.status.padEnd(10)}] id=${idShort}… attempts=${j.attempts}/${j.max_attempts} created=${j.created_at}`)
      if (j.error) console.log(`      Error: ${j.error.slice(0, 300)}`)
    }
  }
} catch (err) {
  console.log(`   ❌ Query error: ${err.message}`)
}

console.log()

// 4. Check chunks with NULL embeddings
console.log("4. Checking chunks with NULL embeddings (pending embed)...")
try {
  const pending = await sql`
    SELECT c.syllabus_id, su.original_filename, count(*)::int AS pending_chunks
    FROM chunks c
    JOIN syllabus_uploads su ON su.id = c.syllabus_id
    WHERE c.embedding IS NULL
    GROUP BY c.syllabus_id, su.original_filename
    ORDER BY pending_chunks DESC
    LIMIT 10
  `
  if (pending.length === 0) {
    console.log("   ✅ No chunks pending embeddings.")
  } else {
    console.log(`   ⚠️  ${pending.length} documents have chunks with NULL embeddings:`)
    for (const p of pending) {
      console.log(`   - ${p.original_filename} (${p.pending_chunks} chunks pending) [${p.syllabus_id.slice(0, 8)}…]`)
    }
  }
} catch (err) {
  console.log(`   ❌ Query error: ${err.message}`)
}

console.log()

// 5. Check document statuses
console.log("5. Checking syllabus_uploads statuses...")
try {
  const statuses = await sql`
    SELECT status, count(*)::int AS cnt
    FROM syllabus_uploads
    GROUP BY status
    ORDER BY cnt DESC
  `
  for (const s of statuses) {
    const icon = s.status === "processed" ? "✅" : s.status === "error" ? "❌" : "⚠️"
    console.log(`   ${icon} ${s.status}: ${s.cnt}`)
  }
} catch (err) {
  console.log(`   ❌ Query error: ${err.message}`)
}

console.log()

// 6. Check for documents stuck in error/pending
console.log("6. Documents stuck in 'pending' or 'error'...")
try {
  const stuck = await sql`
    SELECT id, original_filename, status, created_at, error_message
    FROM syllabus_uploads
    WHERE status IN ('pending', 'error', 'needs_ocr')
    ORDER BY created_at DESC
    LIMIT 10
  `
  if (stuck.length === 0) {
    console.log("   ✅ No stuck documents.")
  } else {
    console.log(`   ⚠️  ${stuck.length} documents stuck:`)
    for (const s of stuck) {
      console.log(`   [${s.status}] ${s.original_filename} created=${s.created_at}`)
      if (s.error_message) console.log(`      Error: ${s.error_message.slice(0, 400)}`)
    }
  }
} catch (err) {
  console.log(`   ❌ Query error: ${err.message}`)
}

console.log()

// 7. Chunks overview
console.log("7. Chunks overview...")
try {
  const cs = await sql`
    SELECT 
      count(*)::int AS total,
      count(*) FILTER (WHERE embedding IS NOT NULL)::int AS with_embedding,
      count(*) FILTER (WHERE embedding IS NULL)::int AS without_embedding
    FROM chunks
  `
  const r = cs[0]
  console.log(`   Total chunks: ${r.total}`)
  console.log(`   With embedding: ${r.with_embedding}`)
  console.log(`   Without embedding (pending): ${r.without_embedding}`)
} catch (err) {
  console.log(`   ❌ Query error: ${err.message}`)
}

console.log("\n=== Done ===")
