import { neon, neonConfig } from "@neondatabase/serverless"

// Optimización: reutiliza la conexión entre llamadas en el mismo
// invocation de Vercel Edge / Node.js.
neonConfig.fetchConnectionCache = true

const dbUrl = process.env.DATABASE_URL || "postgres://dummy:dummy@dummy/dummy"

if (!process.env.DATABASE_URL) {
  console.warn(
    "⚠️ DATABASE_URL no está definida. Si estás en build, puedes ignorar esto. " +
    "Asegúrate de configurarla en runtime."
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
export const sql = neon(dbUrl)

/**
 * Conexión directa (opcional) recomendada para migraciones (scripts).
 */
export const sqlDirect = neon(process.env.DATABASE_URL_DIRECT ?? dbUrl)
