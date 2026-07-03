/**
 * llm/agent-models.ts — role → model map for the multi-agent Study Engine.
 *
 * The Study Engine runs on DIRECT provider APIs: OpenAI for generation (strict
 * json_schema output in _base.ts) and DeepSeek for the reasoning roles. The
 * Bluesmind gateway was dropped as default on 2026-07-01: every model it lists
 * fails live (gpt-5.4 → 503 "no available channel", gpt-5-nano → 504, gemini →
 * 500, deepseek/* → 403/400). The "bluesmind" provider is still accepted via
 * env overrides if the gateway comes back. Each role's model is overridable
 * per-deploy via env (no code change).
 *
 * Preset:
 *   - creative engine (inquisitor, case)  → openai gpt-5-mini
 *   - volume processors (synth, flashcard)→ openai gpt-4o-mini
 *   - router                              → openai gpt-5-nano
 *   - verifier                            → deepseek deepseek-chat (direct; the
 *     reasoner's full CoT made every cold quiz-stage generation 1.5-3 min —
 *     batched boolean gating doesn't need it. MODEL_VERIFIER env restores it.)
 *   - grader (reasoning, unused today)    → deepseek deepseek-reasoner (direct)
 *
 * Fallbacks stay on OpenAI (the consistently-up provider) so one flaky model
 * never empties a study set. Embeddings stay on OpenAI; the chat assistant is
 * separate (llm/selectModel) and runs on the direct DeepSeek provider.
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
  const v = process.env[name]?.trim()
  if (!v) return def
  // Gateway-era ids: gpt-5.4 / gemini-* only existed on Bluesmind, and deepseek
  // ids were vendor-prefixed there. Map stale deploy envs so they can't 404.
  if (/^(gpt-5\.4|gemini)/.test(v)) return def
  return v.replace(/^deepseek\//, "")
}

const OA: AgentProvider = "openai"
const DS: AgentProvider = "deepseek"
const SAFE = "gpt-4o-mini" // cheap + consistently up → universal OpenAI fallback

const RAW: Record<
  AgentRole,
  { provider: AgentProvider; model: string; fallback?: string; fallbackProvider?: AgentProvider }
> = {
  // Each role falls back to an OpenAI model when its primary errors / is down.
  router: { provider: OA, model: env("MODEL_ROUTER", "gpt-5-nano"), fallback: SAFE },
  synth: { provider: OA, model: env("MODEL_SYNTH", "gpt-4o-mini"), fallback: "gpt-5-mini" },
  flashcard: { provider: OA, model: env("MODEL_FLASHCARD", "gpt-4o-mini"), fallback: "gpt-5-mini" },
  inquisitor: { provider: OA, model: env("MODEL_INQUISITOR", "gpt-5-mini"), fallback: SAFE },
  case: { provider: OA, model: env("MODEL_CASE", "gpt-5-mini"), fallback: SAFE },
  verifier: {
    provider: DS,
    model: env("MODEL_VERIFIER", "deepseek-chat"),
    fallback: "gpt-5-mini",
    fallbackProvider: OA,
  },
  grader: {
    provider: DS,
    model: env("MODEL_GRADER", "deepseek-reasoner"),
    fallback: "gpt-5-mini",
    fallbackProvider: OA,
  },
}

export function resolveAgentModel(role: AgentRole): RoleModel {
  const r = RAW[role]
  return {
    provider: r.provider,
    model: r.model,
    fallback: r.fallback,
    fallbackProvider: r.fallbackProvider,
  }
}
