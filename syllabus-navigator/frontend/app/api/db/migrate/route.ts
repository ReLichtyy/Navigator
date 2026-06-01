/**
 * /api/db/migrate — DESHABILITADO
 *
 * Este endpoint fue eliminado por seguridad.
 * La migración se aplica manualmente desde terminal con:
 *
 *   node scripts/migrate.mjs
 *
 * Ver: frontend/scripts/migrate.mjs
 */
import { NextResponse } from "next/server"

export async function GET() {
  return NextResponse.json({ error: "Not found" }, { status: 404 })
}

export async function POST() {
  return NextResponse.json({ error: "Not found" }, { status: 404 })
}
