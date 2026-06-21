#!/usr/bin/env node
/**
 * scripts/wipe-users.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * DESTRUCTIVO: borra TODOS los usuarios y sus datos (chats, uploads, usage,
 * feedback, jobs). El schema se conserva. Úsalo para volver a un estado limpio.
 *
 *   node scripts/wipe-users.mjs          # dry run, solo cuenta
 *   node scripts/wipe-users.mjs --yes    # ejecuta el wipe
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

// Cargar .env.local si existe
const envPath = join(__dirname, "..", ".env.local")
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf-8").split("\n")
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
    if (!(key in process.env)) process.env[key] = val
  }
}

const DATABASE_URL = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error("✖  ERROR: DATABASE_URL no está definida en .env.local")
  process.exit(1)
}

const { neon } = require("@neondatabase/serverless")
const sql = neon(DATABASE_URL)
const confirmed = process.argv.includes("--yes")

const TABLES = [
  "feedback",
  "messages",
  "usage_records",
  "chats",
  "topic_dependencies",
  "topics",
  "chunks",
  "syllabus_uploads",
  "jobs",
  "user_preferences",
  "users",
]

async function run() {
  const before = await sql`SELECT count(*)::int AS n FROM users`
  console.log(`Usuarios actualmente en la BD: ${before[0].n}`)

  if (!confirmed) {
    console.log("\nDRY RUN. Re-ejecuta con --yes para borrar TODO (usuarios + chats + uploads + usage).")
    return
  }

  await sql.query(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`)

  const after = await sql`SELECT count(*)::int AS n FROM users`
  console.log(`\n✅ Wipe completo. Usuarios ahora: ${after[0].n}`)
}

run().catch((err) => {
  console.error("✖  Error:", err.message)
  process.exit(1)
})
