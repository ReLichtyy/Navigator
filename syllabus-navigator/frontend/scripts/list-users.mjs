#!/usr/bin/env node
/**
 * scripts/list-users.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Script local para listar los usuarios registrados en Neon Postgres.
 *
 * Uso:
 *   node scripts/list-users.mjs
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

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error("✖  ERROR: DATABASE_URL no está definida en .env.local")
  process.exit(1)
}

const { neon } = require("@neondatabase/serverless")
const sql = neon(DATABASE_URL)

async function run() {
  try {
    console.log("📡 Conectando a Neon Postgres y recuperando usuarios...\n")
    
    const users = await sql`
      SELECT id, email, display_name, role, created_at 
      FROM users
      ORDER BY created_at DESC
    `

    if (users.length === 0) {
      console.log("ℹ No hay usuarios registrados en la base de datos.")
    } else {
      console.log(`✅ Se encontraron ${users.length} usuarios:`)
      console.table(users.map(u => ({
        ID: u.id,
        Email: u.email,
        Nombre: u.display_name,
        Rol: u.role,
        "Creado el": new Date(u.created_at).toLocaleString()
      })))
    }
  } catch (err) {
    console.error("✖ Error al consultar la base de datos:", err.message)
  } finally {
    process.exit(0)
  }
}

run()
