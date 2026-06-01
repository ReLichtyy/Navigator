/**
 * GET /api/health
 *
 * Healthcheck server-side que verifica:
 *   1. Que DATABASE_URL esté configurada.
 *   2. Que Neon responda correctamente (SELECT NOW()).
 *   3. Que las tablas clave de la app existen.
 *
 * ⚠️  Route Handler — server-side ONLY. DATABASE_URL nunca se expone al cliente.
 *
 * Respuesta 200 → sistema operativo.
 * Respuesta 503 → algún componente falla.
 */

import { sql } from "@/lib/db"
import { NextResponse } from "next/server"

// Tablas mínimas que deben existir para que la app funcione.
const REQUIRED_TABLES = ["syllabus_uploads", "chats", "messages"]

export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {}

  // ── 1. Ping a Neon ────────────────────────────────────────────────────────
  try {
    const rows = await sql`SELECT NOW() AS time`
    const dbTime: string = rows[0]?.time ?? "unknown"
    checks.neon_ping = { ok: true, detail: dbTime }
  } catch (err) {
    checks.neon_ping = {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    }
  }

  // ── 2. Verificar tablas ───────────────────────────────────────────────────
  try {
    const rows = await sql`
      SELECT tablename
      FROM   pg_tables
      WHERE  schemaname = 'public'
        AND  tablename = ANY(${REQUIRED_TABLES})
    `
    const found = (rows as { tablename: string }[]).map((r) => r.tablename)
    const missing = REQUIRED_TABLES.filter((t) => !found.includes(t))

    checks.required_tables = {
      ok: missing.length === 0,
      detail:
        missing.length === 0
          ? `Presentes: ${found.join(", ")}`
          : `Faltan: ${missing.join(", ")} — ejecuta POST /api/db/migrate`,
    }
  } catch (err) {
    checks.required_tables = {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    }
  }

  // ── 3. Resultado final ────────────────────────────────────────────────────
  const allOk = Object.values(checks).every((c) => c.ok)

  return NextResponse.json(
    {
      status: allOk ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: allOk ? 200 : 503 }
  )
}
