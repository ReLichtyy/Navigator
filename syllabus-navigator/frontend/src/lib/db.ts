/**
 * db.ts — Módulo de conexión a Neon Postgres (server-side only).
 *
 * ⚠️  Este archivo SOLO debe importarse desde:
 *     - app/api/... (Route Handlers)
 *     - Server Actions (`"use server"`)
 *     - Componentes Server (sin `"use client"`)
 *
 * Nunca exportes ni re-exportes este módulo desde un archivo que
 * tenga `"use client"` al inicio; Next.js lo detectará y lanzará
 * un error de build.
 */

import { neon, neonConfig } from "@neondatabase/serverless"

// Optimización: reutiliza la conexión entre llamadas en el mismo
// invocation de Vercel Edge / Node.js.
neonConfig.fetchConnectionCache = true

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL no está definida. " +
      "Añade la variable en .env.local (desarrollo) o en Vercel → Settings → Environment Variables (producción)."
  )
}

/**
 * `sql` es el cliente de Neon listo para usar con template literals.
 *
 * @example
 * import { sql } from "@/lib/db"
 *
 * // En un Route Handler o Server Component:
 * const rows = await sql`SELECT NOW() AS time`
 * console.log(rows[0].time)
 */
export const sql = neon(process.env.DATABASE_URL)
