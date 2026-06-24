/**
 * GET /api/health — Comprehensive health check.
 *
 * Checks: database, LLM provider, cache, system status.
 * Returns 200 if all OK, 503 if any subsystem is degraded.
 */

import { sql } from "@/lib/db"
import { NextResponse } from "next/server"
import { getCache } from "@/lib/cache"
import { cached } from "@/lib/cache"
import { openaiProvider } from "@/lib/llm/providers/openai"
import { openrouterProvider } from "@/lib/llm/providers/openrouter"

export const dynamic = "force-dynamic"

const REQUIRED_TABLES = [
  "syllabus_uploads",
  "programs",
  "courses",
  "syllabi",
  "topics",
  "topic_dependencies",
  "chats",
  "messages",
  "user_courses",
  "course_suggestions",
]

const startTime = Date.now()

export async function GET() {
  try {
    // Use a 10s cache to prevent health-check spam
    const result = await cached("health:status", 10, async () => {
      const checks: Record<string, { ok: boolean; detail?: string; latency_ms?: number }> = {}

      // ── Database ──────────────────────────────────────────────────────────
      const dbStart = performance.now()
      try {
        const rows = await sql`SELECT NOW() AS time`
        const dbTime = (rows as { time: string }[])[0]?.time ?? "unknown"
        const dbMs = Math.round(performance.now() - dbStart)

        // Check tables
        const tableRows = await sql`
          SELECT tablename FROM pg_tables
          WHERE schemaname = 'public'
            AND tablename = ANY(${REQUIRED_TABLES})
        `
        const found = (tableRows as { tablename: string }[]).map((r) => r.tablename)
        const missing = REQUIRED_TABLES.filter((t) => !found.includes(t))

        checks.database = {
          ok: missing.length === 0,
          detail:
            missing.length === 0
              ? `Connected. Server time: ${dbTime}`
              : `Missing tables: ${missing.join(", ")}`,
          latency_ms: dbMs,
        }
      } catch (err) {
        checks.database = {
          ok: false,
          detail: err instanceof Error ? err.message : String(err),
          latency_ms: Math.round(performance.now() - dbStart),
        }
      }

      // ── LLM Provider ──────────────────────────────────────────────────────
      const llmProviders: string[] = []
      if (openaiProvider.isConfigured()) llmProviders.push("openai")
      if (openrouterProvider.isConfigured()) llmProviders.push("openrouter")

      checks.llm = {
        ok: llmProviders.length > 0,
        detail:
          llmProviders.length > 0
            ? `Configured: ${llmProviders.join(", ")}`
            : "No LLM provider configured. Set OPENAI_API_KEY or OPENROUTER_API_KEY.",
      }

      // ── Cache ─────────────────────────────────────────────────────────────
      const cache = getCache()
      try {
        const testKey = "_health_check_"
        await cache.set(testKey, "ok", 5)
        const val = await cache.get<string>(testKey)
        await cache.del(testKey)
        checks.cache = {
          ok: val === "ok",
          detail: `Adapter: ${cache.name}. Read/write: ${val === "ok" ? "pass" : "fail"}.`,
        }
      } catch (err) {
        checks.cache = {
          ok: false,
          detail: err instanceof Error ? err.message : String(err),
        }
      }

      // ── System ────────────────────────────────────────────────────────────
      checks.system = {
        ok: true,
        detail: `Uptime: ${Math.round((Date.now() - startTime) / 1000)}s. Environment: ${process.env.NODE_ENV ?? "unknown"}.`,
      }

      const allOk = Object.values(checks).every((c) => c.ok)

      return {
        status: allOk ? "ok" : "degraded",
        timestamp: new Date().toISOString(),
        checks,
      }
    })

    const statusCode = result.status === "ok" ? 200 : 503
    return NextResponse.json(result, { status: statusCode })
  } catch (err) {
    return NextResponse.json(
      {
        error: "Health check failed entirely.",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }
}
