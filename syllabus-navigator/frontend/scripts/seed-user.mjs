#!/usr/usr/bin/env node
/**
 * scripts/seed-user.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Seed Script for Test User creation.
 * 
 * Usage:
 *   node scripts/seed-user.mjs
 * 
 * Requires these env vars in .env.local:
 *   SEED_TEST_EMAIL
 *   SEED_TEST_PASSWORD
 *   SEED_TEST_NAME (Optional, default: Test User)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import bcrypt from "bcryptjs"

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.local
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
const SEED_EMAIL = process.env.SEED_TEST_EMAIL
const SEED_PASSWORD = process.env.SEED_TEST_PASSWORD
const SEED_NAME = process.env.SEED_TEST_NAME || "Test User"

if (!DATABASE_URL || !SEED_EMAIL || !SEED_PASSWORD) {
  console.error("✖ ERROR: Missing required environment variables.")
  console.error("  Ensure DATABASE_URL, SEED_TEST_EMAIL, and SEED_TEST_PASSWORD are set.")
  process.exit(1)
}

const { neon } = require("@neondatabase/serverless")
const sql = neon(DATABASE_URL)

async function seed() {
  console.log(`\n🌱 Starting user seed process for: ${SEED_EMAIL}`)
  try {
    // Check if user already exists
    const existing = await sql`SELECT id FROM users WHERE email = ${SEED_EMAIL}`
    if (existing.length > 0) {
      console.log(`ℹ User ${SEED_EMAIL} already exists (ID: ${existing[0].id}). Skipping.`)
      process.exit(0)
    }

    // Hash password securely
    console.log(`  - Hashing password...`)
    const hash = await bcrypt.hash(SEED_PASSWORD, 12)

    // Insert User
    console.log(`  - Inserting user...`)
    const rows = await sql`
      INSERT INTO users (email, password_hash, display_name, role)
      VALUES (${SEED_EMAIL}, ${hash}, ${SEED_NAME}, 'admin')
      RETURNING id
    `
    const userId = rows[0].id

    // Insert Default Preferences
    console.log(`  - Inserting default preferences...`)
    await sql`
      INSERT INTO user_preferences (user_id, default_provider, default_model)
      VALUES (${userId}::uuid, 'openai', 'gpt-4o-mini')
    `

    console.log(`✅ User seeded successfully! ID: ${userId}\n`)
    process.exit(0)
  } catch (error) {
    console.error(`✖ ERROR: Failed to seed user.`)
    console.error(error)
    process.exit(1)
  }
}

seed()
