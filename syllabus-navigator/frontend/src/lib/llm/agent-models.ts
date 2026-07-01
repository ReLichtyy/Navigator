/**
 * llm/agent-models.ts — role → model map for the multi-agent Study Engine.
 *
 * The whole backend Study Engine runs on the BLUESMIND gateway (OpenAI-compatible:
 * one BLUESMIND_API_KEY + BLUESMIND_BASE_URL serves every vendor id). "Best model
 * for each job": a cheap/fast model for high-volume roles, a creative model for
 * generation, a reasoning model for verification/grading. Each role's model is
 * overridable per-deploy via env (no code change).
 *
 * Preset (all via the Bluesmind gateway):
 *   - creative engine (inquisitor, case)  → gpt-5.4
 *   - volume processors (synth, flashcard)→ gemini-3.1-flash-lite-preview
 *   - router                              → gpt-5-nano
 *   - verifier / grader (reasoning)       → deepseek/deepseek-reasoner
 *
 * Every role falls back to gpt-5.4 (the consistently-up Bluesmind model) so a model
 * the gateway hasn't fully enabled yet (deepseek/* pricing, flaky gemini/nano
 * upstream) never empties a study set. Embeddings stay on OpenAI; the chat assistant
 * is separate (llm/selectModel) and runs on the direct DeepSeek provider.
 */
import type { LLMProvider } from "./types"

/** Study Engine providers: the base LLM providers plus the Bluesmind gateway. */
export type AgentProvider = LLMProvider | "bluesmind"

export type AgentRole =
  | "router"
  | "synth"
  | "inquisitor"
  | "case"
  | "flashcard"
  | "verifier"
  | "grader"

export interface RoleModel {
  provider: AgentProvider
  model: string
  fallback?: string
  /** Provider for the fallback model (defaults to `provider` when omitted). */
  fallbackProvider?: AgentProvider
}

function env(name: string, def: string): string {
  const v = process.env[name]
  return v && v.trim() ? v.trim() : def
}

const BS: AgentProvider = "bluesmind" // every Study Engine role runs on the gateway
const SAFE = "gpt-5.4" // the consistently-up Bluesmind model → universal fallback

const RAW: Record<AgentRole, { provider: AgentProvider; model: string; fallback?: string; fallbackProvider?: AgentProvider }> = {
  // Each role falls back to gpt-5.4 (same provider) when its model errors / isn't enabled.
  router: { provider: BS, model: env("MODEL_ROUTER", "gpt-5-nano"), fallback: SAFE },
  synth: { provider: BS, model: env("MODEL_SYNTH", "gemini-3.1-flash-lite-preview"), fallback: SAFE },
  flashcard: { provider: BS, model: env("MODEL_FLASHCARD", "gemini-3.1-flash-lite-preview"), fallback: SAFE },
  inquisitor: { provider: BS, model: env("MODEL_INQUISITOR", "gpt-5.4") },
  case: { provider: BS, model: env("MODEL_CASE", "gpt-5.4") },
  verifier: { provider: BS, model: env("MODEL_VERIFIER", "deepseek/deepseek-reasoner"), fallback: SAFE },
  grader: { provider: BS, model: env("MODEL_GRADER", "deepseek/deepseek-reasoner"), fallback: SAFE },
}

export function resolveAgentModel(role: AgentRole): RoleModel {
  const r = RAW[role]
  return { provider: r.provider, model: r.model, fallback: r.fallback, fallbackProvider: r.fallbackProvider }
}
