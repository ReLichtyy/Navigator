#!/usr/bin/env node
/**
 * scripts/seed-demo.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Seed demo content (Sprint 3 #3): a fully-processed sample syllabus with
 * chunks, a topic graph (topics + dependencies) and schedule events, so a fresh
 * database has something to show in the graph (/mapa), agenda (/agenda) and chat
 * without uploading a PDF first.
 *
 * Idempotent: keyed on a fixed source_hash; re-running replaces the demo upload
 * (cascading to its chunks/topics/dependencies/schedule).
 *
 * Target user resolution (first match wins):
 *   1. SEED_TEST_EMAIL  (same var seed-user.mjs uses)
 *   2. the first 'admin' user
 *   3. the oldest user
 * If the users table is empty, run `node scripts/seed-user.mjs` first.
 *
 * Usage:  node scripts/seed-demo.mjs        (or: npm run db:seed-demo)
 * Requires DATABASE_URL in .env.local.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.local (same minimal parser as the other scripts)
const envPath = join(__dirname, "..", ".env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
    if (!(key in process.env)) process.env[key] = val
  }
}

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error("✖ ERROR: DATABASE_URL is required (set it in .env.local).")
  process.exit(1)
}

const { neon } = require("@neondatabase/serverless")
const sql = neon(DATABASE_URL)

const DEMO_HASH = "demo-seed-v1"
const DEMO_NAME = "Estructuras de Datos (demo)"

// Course content: a small dependency graph.
const TOPICS = [
  { ext: "n1", label: "Arreglos", weight: 10, desc: "Estructuras lineales de tamaño fijo." },
  { ext: "n2", label: "Listas enlazadas", weight: 15, desc: "Nodos enlazados dinámicamente." },
  { ext: "n3", label: "Recursión", weight: 15, desc: "Funciones que se invocan a sí mismas." },
  { ext: "n4", label: "Árboles", weight: 25, desc: "Estructuras jerárquicas; BST y recorridos." },
  { ext: "n5", label: "Grafos", weight: 35, desc: "Nodos y aristas; BFS/DFS y caminos." },
]
// prerequisite -> target (by external id)
const DEPS = [
  ["n1", "n2"],
  ["n2", "n4"],
  ["n3", "n4"],
  ["n4", "n5"],
]

const CHUNKS = [
  "Arreglos: acceso O(1) por índice, tamaño fijo. Base de muchas otras estructuras.",
  "Listas enlazadas: inserción/borrado O(1) en los extremos; sin acceso aleatorio.",
  "Recursión: caso base y caso recursivo; fundamental para recorrer árboles.",
  "Árboles binarios de búsqueda: búsqueda O(log n) si están balanceados; recorridos inorden/preorden/postorden.",
  "Grafos: representación por lista o matriz de adyacencia; BFS y DFS para recorrido.",
]

function isoDateInDays(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

const SCHEDULE = [
  { type: "quiz", title: "Quiz 1: Arreglos y listas", date: isoDateInDays(5), week: "Semana 2", weight: 10 },
  { type: "assignment", title: "Tarea: Recorridos de árboles", date: isoDateInDays(10), week: "Semana 4", weight: 15 },
  { type: "exam", title: "Examen parcial: Árboles y grafos", date: isoDateInDays(20), week: "Semana 6", weight: 30 },
]

async function resolveUser() {
  const email = process.env.SEED_TEST_EMAIL
  if (email) {
    const byEmail = await sql`SELECT id, email FROM users WHERE email = ${email}`
    if (byEmail.length) return byEmail[0]
    console.warn(`ℹ SEED_TEST_EMAIL="${email}" not found; falling back to an existing user.`)
  }
  const admin = await sql`SELECT id, email FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`
  if (admin.length) return admin[0]
  const any = await sql`SELECT id, email FROM users ORDER BY created_at ASC LIMIT 1`
  return any[0] ?? null
}

async function seed() {
  console.log("\n🌱 Seeding demo content...")
  const user = await resolveUser()
  if (!user) {
    console.error("✖ No users found. Run `node scripts/seed-user.mjs` first.")
    process.exit(1)
  }
  const userId = user.id
  console.log(`  - Target user: ${user.email} (${userId})`)

  // Idempotent: drop any prior demo upload (cascades to chunks/topics/deps/schedule).
  await sql`DELETE FROM syllabus_uploads WHERE user_id = ${String(userId)} AND source_hash = ${DEMO_HASH}`

  const [upload] = await sql`
    INSERT INTO syllabus_uploads (user_id, original_filename, source_hash, status, graph_status, graph_generated_at)
    VALUES (${String(userId)}, ${DEMO_NAME}, ${DEMO_HASH}, 'processed', 'ready', now())
    RETURNING id
  `
  const syllabusId = upload.id
  console.log(`  - Upload created: ${syllabusId}`)

  // Chunks (text only; no embeddings — retrieval over the demo isn't the point,
  // the graph/agenda/study views are). chunk_index is unique per syllabus.
  for (let i = 0; i < CHUNKS.length; i++) {
    await sql`
      INSERT INTO chunks (syllabus_id, chunk_index, content, page_start, page_end)
      VALUES (${syllabusId}::uuid, ${i}, ${CHUNKS[i]}, 1, 1)
    `
  }
  console.log(`  - Chunks: ${CHUNKS.length}`)

  // Topics, capturing the generated ids by external_id for the dependency links.
  const idByExt = {}
  for (const t of TOPICS) {
    const [row] = await sql`
      INSERT INTO topics (syllabus_id, external_id, label, description, weight_percent)
      VALUES (${syllabusId}::uuid, ${t.ext}, ${t.label}, ${t.desc}, ${t.weight})
      RETURNING id
    `
    idByExt[t.ext] = row.id
  }
  console.log(`  - Topics: ${TOPICS.length}`)

  for (const [pre, tgt] of DEPS) {
    await sql`
      INSERT INTO topic_dependencies (syllabus_id, prerequisite_topic_id, target_topic_id, relation_type, confidence)
      VALUES (${syllabusId}::uuid, ${idByExt[pre]}::uuid, ${idByExt[tgt]}::uuid, 'prerequisite', 0.9)
    `
  }
  console.log(`  - Dependencies: ${DEPS.length}`)

  for (const e of SCHEDULE) {
    await sql`
      INSERT INTO schedule_events (syllabus_id, user_id, event_type, title, event_date, week_label, weight_percent)
      VALUES (${syllabusId}::uuid, ${String(userId)}, ${e.type}, ${e.title}, ${e.date}, ${e.week}, ${e.weight})
    `
  }
  console.log(`  - Schedule events: ${SCHEDULE.length}`)

  console.log(`\n✅ Demo seeded for ${user.email}. Open /mapa and /agenda to see it.\n`)
  process.exit(0)
}

seed().catch((err) => {
  console.error("✖ ERROR: Failed to seed demo content.")
  console.error(err)
  process.exit(1)
})
