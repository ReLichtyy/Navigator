/**
 * scripts/test-connection.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Script standalone para verificar la conexión a Neon Postgres.
 * Levanta un servidor HTTP en :3000 y responde con la versión de Postgres.
 *
 * Uso:
 *   node scripts/test-connection.js
 *   curl http://localhost:3000
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { existsSync, readFileSync } = require("fs")
const { join } = require("path")

// Cargar .env.local manualmente (sin depender de dotenv)
const envPath = join(__dirname, "..", ".env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "")
    if (!(key in process.env)) process.env[key] = val
  }
  console.log("✔  .env.local cargado")
}

const { neon } = require("@neondatabase/serverless")

if (!process.env.DATABASE_URL) {
  console.error("✖  DATABASE_URL no definida")
  process.exit(1)
}

const sql = neon(process.env.DATABASE_URL)

const http = require("http")

const requestHandler = async (req, res) => {
  try {
    const result = await sql`SELECT version()`
    const { version } = result[0]
    res.writeHead(200, { "Content-Type": "text/plain" })
    res.end(version)
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" })
    res.end("Error: " + err.message)
  }
}

http.createServer(requestHandler).listen(3000, () => {
  console.log("🚀  Test server en http://localhost:3000")
  console.log("    Abre esa URL o usa: curl http://localhost:3000")
  console.log("    Ctrl+C para detener\n")
})
