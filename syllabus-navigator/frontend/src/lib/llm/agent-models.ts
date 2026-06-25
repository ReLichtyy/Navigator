/**
 * llm/agent-models.ts — role → model map for the multi-agent Study Engine.
 *
 * "Best model for each job": cheap+fast for high-volume/low-risk roles, stronger
 * models for reasoning/verification. Each role is overridable per-deploy via env
 * (no code change) and carries a fallback. Defaults are OpenAI ids so the engine
 * runs with just OPENAI_API_KEY; point a role at an OpenRouter id (contains "/")
 * to use Claude/Gemini etc. — e.g. MODEL_VERIFIER=anthropic/claude-sonnet-4.x
 * for cross-family verification (see rag-report §9.4).
 *
 * Embeddings are NOT here — they stay on OpenAI in llm/embeddings.ts (OpenRouter
 * has no /embeddings endpoint).
 */
import type { LLMProvider } from "./types"

export type AgentRole =
  | "router"
  | "synth"
  | "inquisitor"
  | "case"
  | "flashcard"
  | "verifier"
  | "grader"

export interface RoleModel {
  provider: LLMProvider
  model: string
  fallback?: string
}

function env(name: string, def: string): string {
  const v = process.env[name]
  return v && v.trim() ? v.trim() : def
}

/** OpenRouter ids are namespaced ("vendor/model"); bare ids are OpenAI. */
function providerOf(model: string): LLMProvider {
  return model.includes("/") ? "openrouter" : "openai"
}

// Quality preset within OpenAI defaults (gpt-4o for reasoning/verification, mini
// for high-volume). Override via env to the §9.4 OpenRouter preset when desired.
const RAW: Record<AgentRole, { model: string; fallback?: string }> = {
  router: { model: env("MODEL_ROUTER", "gpt-4o-mini") },
  synth: { model: env("MODEL_SYNTH", "gpt-4o-mini") },
  flashcard: { model: env("MODEL_FLASHCARD", "gpt-4o-mini") },
  inquisitor: { model: env("MODEL_INQUISITOR", "gpt-4o"), fallback: "gpt-4o-mini" },
  case: { model: env("MODEL_CASE", "gpt-4o"), fallback: "gpt-4o-mini" },
  verifier: { model: env("MODEL_VERIFIER", "gpt-4o"), fallback: "gpt-4o-mini" },
  grader: { model: env("MODEL_GRADER", "gpt-4o"), fallback: "gpt-4o-mini" },
}

export function resolveAgentModel(role: AgentRole): RoleModel {
  const r = RAW[role]
  return { provider: providerOf(r.model), model: r.model, fallback: r.fallback }
}

export const AGENT_MODELS = RAW
