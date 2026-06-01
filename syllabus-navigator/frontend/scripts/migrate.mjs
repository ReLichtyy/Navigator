#!/usr/bin/env node
/**
 * scripts/migrate.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Script local para aplicar el DDL de Syllabus Navigator en Neon Postgres.
 * Se ejecuta UNA sola vez desde la terminal del desarrollador; NUNCA es un
 * endpoint HTTP público.
 *
 * Uso:
 *   # Desde la raíz de /frontend:
 *   node scripts/migrate.mjs
 *
 *   # O pasando DATABASE_URL directamente:
 *   DATABASE_URL="postgresql://..." node scripts/migrate.mjs
 *
 * El script carga automáticamente .env.local si existe en /frontend.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

// ── 1. Cargar .env.local si existe ──────────────────────────────────────────
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
  console.log("✔  Variables cargadas desde .env.local")
} else {
  console.log("ℹ  .env.local no encontrado; se usan variables de entorno del sistema.")
}

// ── 2. Validar DATABASE_URL ──────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error(
    "\n✖  ERROR: DATABASE_URL no está definida.\n" +
    "   Crea frontend/.env.local con:\n" +
    "   DATABASE_URL=postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require\n"
  )
  process.exit(1)
}

// ── 3. Leer DDL ──────────────────────────────────────────────────────────────
const schemaPath = join(__dirname, "..", "src", "lib", "schema.sql")
if (!existsSync(schemaPath)) {
  console.error(`\n✖  No se encontró el archivo DDL en:\n   ${schemaPath}\n`)
  process.exit(1)
}
const DDL = readFileSync(schemaPath, "utf-8")

// ── 4. Conectar a Neon y ejecutar ────────────────────────────────────────────
const { neon } = require("@neondatabase/serverless")
const sql = neon(DATABASE_URL)

const statements = DDL.split(";")
  .map((s) => s.trim())
  .filter(Boolean)

console.log(`\n🚀  Aplicando migración en Neon Postgres…`)
console.log(`    Sentencias encontradas: ${statements.length}\n`)

let applied = 0
let failed = 0

for (const stmt of statements) {
  // Mostrar primera línea de la sentencia como contexto
  const preview = stmt.split("\n").find((l) => l.trim() && !l.trim().startsWith("--")) ?? stmt
  const label = preview.slice(0, 72).trim()

  try {
    await sql.query(stmt)
    console.log(`  ✔  ${label}`)
    applied++
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`  ✖  ${label}`)
    console.error(`     → ${msg}`)
    failed++
  }
}

// ── 5. Resumen ───────────────────────────────────────────────────────────────
console.log(`\n────────────────────────────────────────────────────────────────────────`)
console.log(`  Migración completada: ${applied} OK, ${failed} errores.`)

if (failed > 0) {
  console.log(`\n⚠   Hubo errores. Revisa los mensajes anteriores.`)
  process.exit(1)
} else {
  console.log(`\n✅  Tablas listas. Verifica la conexión con:\n`)
  console.log(`    curl https://<tu-app>.vercel.app/api/health\n`)
  process.exit(0)
}
