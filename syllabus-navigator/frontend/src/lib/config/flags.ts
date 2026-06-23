/**
 * config/flags.ts — Central feature flags (Sprint 3 #4).
 *
 * Single source of truth for environment-driven toggles so swapping the LLM
 * provider or the vector backend is a config change, not a code change. Vercel
 * env vars are static per deployment, so flags are resolved once at module load.
 *
 * Invalid values fall back to a safe default with a one-line warning instead of
 * throwing at import time (a bad env var should degrade, not crash the deploy).
 */

import type { LLMProvider } from "@/lib/llm/types"

/** Vector store backends the retrieval layer knows how to talk to. */
export type VectorBackend = "pgvector"

const KNOWN_PROVIDERS: readonly LLMProvider[] = ["openai", "openrouter"]
const KNOWN_VECTOR_BACKENDS: readonly VectorBackend[] = ["pgvector"]

function warn(message: string): void {
  // Avoid importing the observability logger here: flags is imported very early
  // (incl. by config.ts) and we want it dependency-light and edge-safe.
  // eslint-disable-next-line no-console
  console.warn(JSON.stringify({ level: "warn", event: "flags.invalid", message }))
}

/** Parse the default LLM provider, falling back to `openai`. */
function resolveProvider(raw: string | undefined): LLMProvider {
  if (!raw) return "openai"
  const value = raw.trim().toLowerCase()
  if ((KNOWN_PROVIDERS as readonly string[]).includes(value)) {
    return value as LLMProvider
  }
  warn(`DEFAULT_LLM_PROVIDER="${raw}" is not a known provider; using "openai".`)
  return "openai"
}

/** Parse the vector backend, falling back to `pgvector`. */
function resolveVectorBackend(raw: string | undefined): VectorBackend {
  if (!raw) return "pgvector"
  const value = raw.trim().toLowerCase()
  if ((KNOWN_VECTOR_BACKENDS as readonly string[]).includes(value)) {
    return value as VectorBackend
  }
  warn(`VECTOR_BACKEND="${raw}" is not supported; using "pgvector".`)
  return "pgvector"
}

/** Parse a boolean flag. Anything but "false"/"0"/"off" (case-insensitive) is true. */
function resolveBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback
  const value = raw.trim().toLowerCase()
  return !(value === "false" || value === "0" || value === "off" || value === "no")
}

export interface FeatureFlags {
  /** Default LLM provider when the user/request has no preference. */
  llmProvider: LLMProvider
  /** Default LLM model id when the user/request has no preference. */
  llmModel: string
  /** Vector store powering retrieval. Only `pgvector` (Neon) is wired today. */
  vectorBackend: VectorBackend
  /** Master switch for RAG retrieval. When false, chat answers without grounding. */
  ragEnabled: boolean
}

export const flags: FeatureFlags = {
  llmProvider: resolveProvider(process.env.DEFAULT_LLM_PROVIDER),
  llmModel: (process.env.DEFAULT_LLM_MODEL?.trim() || "gpt-4o-mini"),
  vectorBackend: resolveVectorBackend(process.env.VECTOR_BACKEND),
  ragEnabled: resolveBool(process.env.RAG_ENABLED, true),
}

// Exported for tests so resolution logic can be exercised without mutating env.
export const __testing = {
  resolveProvider,
  resolveVectorBackend,
  resolveBool,
}
