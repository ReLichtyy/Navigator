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
 * Siempre usa la conexión agrupada (pooler) para consultas en tiempo de ejecución.
 *
 * @example
 * import { sql } from "@/lib/db"
 * const rows = await sql`SELECT NOW() AS time`
 */
export const sql = neon(process.env.DATABASE_URL)

/**
 * Conexión directa (opcional) recomendada para migraciones (scripts).
 */
export const sqlDirect = neon(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL)
