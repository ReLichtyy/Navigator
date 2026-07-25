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

const KNOWN_PROVIDERS: readonly LLMProvider[] = ["openai", "openrouter", "deepseek"]
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

/**
 * Parse a language code (BCP-47-ish, e.g. "es", "en", "pt-BR"), falling back to
 * the given default. Today this only feeds the Study Engine's output-language
 * directive; when per-user language preferences land, that preference should
 * override this app-wide default.
 */
function resolveLanguage(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback
  const value = raw.trim()
  if (/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(value)) return value
  warn(`STUDY_LANGUAGE="${raw}" is not a valid language code; using "${fallback}".`)
  return fallback
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
  /**
   * Master switch for the Actions & Tools layer (LLM tool-calling in chat).
   * Off by default: enabling it adds a non-streamed tool-resolution pass before
   * the streamed answer. Turn on with TOOLS_ENABLED=true.
   */
  toolsEnabled: boolean
  /**
   * Default output language for the study area (Study Engine generators +
   * web-search augmentation). App-wide for now (STUDY_LANGUAGE env, default
   * "es"); planned to become a per-user preference that overrides this.
   */
  studyLanguage: string
  /** Durable ingestion/inventory/artifact orchestration. */
  knowledgePipelineV2: boolean
  /** Progressive mind maps with a ready preview and background enrichment. */
  graphPipelineV2: boolean
  /** Persistent study kits selected without inline generation. */
  studyPipelineV2: boolean
}

export const flags: FeatureFlags = {
  llmProvider: resolveProvider(process.env.DEFAULT_LLM_PROVIDER),
  llmModel: process.env.DEFAULT_LLM_MODEL?.trim() || "gpt-4o-mini",
  vectorBackend: resolveVectorBackend(process.env.VECTOR_BACKEND),
  ragEnabled: resolveBool(process.env.RAG_ENABLED, true),
  toolsEnabled: resolveBool(process.env.TOOLS_ENABLED, false),
  studyLanguage: resolveLanguage(process.env.STUDY_LANGUAGE, "es"),
  knowledgePipelineV2: resolveBool(process.env.KNOWLEDGE_PIPELINE_V2, true),
  graphPipelineV2: resolveBool(process.env.GRAPH_PIPELINE_V2, true),
  studyPipelineV2: resolveBool(process.env.STUDY_PIPELINE_V2, false),
}

// Exported for tests so resolution logic can be exercised without mutating env.
export const __testing = {
  resolveProvider,
  resolveVectorBackend,
  resolveBool,
  resolveLanguage,
}
