/**
 * reinfer-pending.mjs — re-run course inference for docs stuck at
 * infer_status='pending' (they failed silently while DEFAULT_MODEL pointed at a
 * non-OpenAI model). Mirrors CourseService.inferForDocument + rag/course-infer.
 * Run: node scratch/reinfer-pending.mjs
 */
import { config } from "dotenv"
config({ path: ".env.local" })
import { neon } from "@neondatabase/serverless"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const MODEL = process.env.RAG_OPENAI_MODEL || "gpt-4o-mini"
const MAX_INFER_CHARS = 6000
if (!OPENAI_API_KEY) { console.error("OPENAI_API_KEY not set"); process.exit(1) }

const sql = neon(process.env.DATABASE_URL)

const SYSTEM_PROMPT =
  "You classify an uploaded academic document (syllabus, notes, article) into the course it " +
  "belongs to. You are given the document's filename, a text excerpt, and the user's existing " +
  "courses. If the document clearly belongs to one of the existing courses, return its id as " +
  "matched_course_id and reuse its name. Otherwise set matched_course_id to null and propose a " +
  "concise new course name (in the document's language) plus 2-5 subject tags. Base confidence " +
  "on how clearly the subject is identifiable; be conservative when unsure."

const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    matched_course_id: { type: ["string", "null"] },
    suggested_name: { type: "string" },
    confidence: { type: "number" },
    subject_tags: { type: "array", items: { type: "string" } },
  },
  required: ["matched_course_id", "suggested_name", "confidence", "subject_tags"],
}

async function infer(filename, text, existing) {
  const list = existing.length
    ? existing.map((c) => `- id=${c.id} name="${c.name}" tags=[${(c.subject_tags ?? []).join(", ")}]`).join("\n")
    : "(none yet)"
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL, temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Existing courses:\n${list}\n\nDocument filename: ${filename}\n\nDocument excerpt:\n${text.slice(0, MAX_INFER_CHARS)}` },
      ],
      response_format: { type: "json_schema", json_schema: { name: "course_inference", strict: true, schema: SCHEMA } },
    }),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${JSON.stringify((await res.json()).error?.message)}`)
  const p = JSON.parse((await res.json()).choices[0].message.content)
  const matched = p.matched_course_id && existing.some((c) => c.id === p.matched_course_id) ? p.matched_course_id : null
  return {
    matchedCourseId: matched,
    suggestedName: p.suggested_name.trim(),
    confidence: p.confidence,
    method: matched ? "combined" : "content",
  }
}

const pending = await sql`
  SELECT id, user_id, original_filename FROM syllabus_uploads
  WHERE infer_status = 'pending' AND expires_at IS NULL AND status = 'processed'
  ORDER BY created_at DESC`
console.log(`${pending.length} pending docs to re-infer with ${MODEL}\n`)

for (const doc of pending) {
  try {
    const rows = await sql`SELECT content FROM chunks WHERE syllabus_id = ${doc.id}::uuid ORDER BY chunk_index ASC`
    const text = rows.map((r) => r.content).join("\n\n")
    if (text.trim().length < 80) { console.log(`SKIP ${doc.original_filename} (no text)`); continue }
    const existing = await sql`SELECT id, name, subject_tags FROM user_courses WHERE user_id = ${doc.user_id}`
    const inf = await infer(doc.original_filename, text, existing)
    await sql`
      INSERT INTO course_suggestions (document_id, suggested_course_id, suggested_name, confidence, method)
      VALUES (${doc.id}::uuid, ${inf.matchedCourseId}, ${inf.suggestedName}, ${inf.confidence}, ${inf.method})`
    await sql`
      UPDATE syllabus_uploads
      SET inferred_course = ${inf.suggestedName}, infer_confidence = ${inf.confidence}, infer_status = 'suggested'
      WHERE id = ${doc.id}::uuid`
    console.log(`OK   ${doc.original_filename} -> "${inf.suggestedName}" (${Math.round(inf.confidence * 100)}%, matched=${Boolean(inf.matchedCourseId)})`)
  } catch (e) {
    console.log(`FAIL ${doc.original_filename}: ${e.message}`)
  }
}
console.log("\nDone.")
