/**
 * Test PPTX parsing with officeparser.
 * Run: node scratch/test-pptx.mjs
 */
import { config } from "dotenv"
config({ path: ".env.local" })

import { parseOfficeAsync } from "officeparser"
import { tmpdir } from "os"
import { mkdtemp, rm, writeFile } from "fs/promises"
import { join } from "path"
import { neon } from "@neondatabase/serverless"

console.log("=== PPTX Diagnostic ===\n")

// 1. Check if there are any pptx documents in the DB
const sql = neon(process.env.DATABASE_URL)

console.log("1. Checking for PPTX/Office uploads in the database...")
try {
  const docs = await sql`
    SELECT id, original_filename, status, source_type, error_message, created_at
    FROM syllabus_uploads
    WHERE source_type IN ('pptx', 'docx', 'xlsx')
       OR original_filename ILIKE '%.pptx'
       OR original_filename ILIKE '%.docx'
       OR original_filename ILIKE '%.xlsx'
    ORDER BY created_at DESC
    LIMIT 10
  `
  if (docs.length === 0) {
    console.log("   ⚠️  No Office documents found in the database.")
  } else {
    console.log(`   Found ${docs.length} Office documents:`)
    for (const d of docs) {
      const icon = d.status === "processed" ? "✅" : d.status === "error" ? "❌" : "⚠️"
      console.log(`   ${icon} [${d.status}] ${d.original_filename} (${d.source_type}) created=${d.created_at}`)
      if (d.error_message) console.log(`      Error: ${d.error_message.slice(0, 400)}`)
      
      // Check chunks for this document
      const chunks = await sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE embedding IS NOT NULL)::int AS embedded
        FROM chunks WHERE syllabus_id = ${d.id}::uuid
      `
      const c = chunks[0]
      console.log(`      Chunks: ${c.total} total, ${c.embedded} embedded`)
    }
  }
} catch (err) {
  console.log(`   ❌ Query error: ${err.message}`)
}

console.log()

// 2. Test officeparser itself with a synthetic PPTX
console.log("2. Testing officeparser library directly...")
console.log(`   officeparser version: 4.2.0`)

// Create a minimal valid PPTX (a PPTX is a ZIP with specific XML inside)
// We can't easily create one in raw JS, so let's just check the library loads
try {
  // Test with empty/invalid input to see error handling
  const dir = await mkdtemp(join(tmpdir(), "officeparse-test-"))
  try {
    console.log(`   Temp dir: ${dir}`)
    // officeparser should throw on invalid input, not hang
    try {
      await parseOfficeAsync(Buffer.from("not a valid file"), {
        tempFilesLocation: dir,
        outputErrorToConsole: false,
      })
      console.log("   ⚠️  officeparser returned without error on invalid input")
    } catch (e) {
      console.log(`   ✅ officeparser correctly rejects invalid input: ${e.message?.slice(0, 100)}`)
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
} catch (err) {
  console.log(`   ❌ officeparser error: ${err.message}`)
}

console.log()

// 3. Check all document statuses and source types
console.log("3. Document status breakdown by source type...")
try {
  const breakdown = await sql`
    SELECT source_type, status, count(*)::int AS cnt
    FROM syllabus_uploads
    GROUP BY source_type, status
    ORDER BY source_type, status
  `
  for (const b of breakdown) {
    console.log(`   ${b.source_type || 'null'} / ${b.status}: ${b.cnt}`)
  }
} catch (err) {
  console.log(`   ❌ Query error: ${err.message}`)
}

console.log("\n=== Done ===")
