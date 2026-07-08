/**
 * llm/agent-models.ts — role → model map for the multi-agent Study Engine.
 *
 * The Study Engine runs on DIRECT provider APIs: OpenAI for generation (strict
 * json_schema output in _base.ts) and DeepSeek for the reasoning roles. The
 * Bluesmind gateway that used to host these roles died 2026-07-01 and was
 * removed — the stale-env guard below still maps its old model ids to safe
 * defaults so a leftover deploy env can't 404. Each role's model is overridable
 * per-deploy via env (no code change).
 *
 * Preset:
 *   - creative engine (inquisitor, case)  → openai gpt-5-mini
 *   - volume processors (synth, flashcard)→ openai gpt-4o-mini
 *   - router                              → openai gpt-5-nano
 *   - verifier                            → deepseek deepseek-chat (direct; the
 *     reasoner's full CoT made every cold quiz-stage generation 1.5-3 min —
 *     batched boolean gating doesn't need it. MODEL_VERIFIER env restores it.)
 *
 * Fallbacks stay on OpenAI (the consistently-up provider) so one flaky model
 * never empties a study set. Embeddings stay on OpenAI; the chat assistant is
 * separate (llm/selectModel) and runs on the direct DeepSeek provider.
 */
import type { LLMProvider } from "./types"

/** Study Engine providers (the base LLM providers; the Bluesmind gateway was removed). */
export type AgentProvider = LLMProvider

export type AgentRole =
  | "router"
  | "synth"
  | "mindmap"
  | "inquisitor"
  | "case"
  | "flashcard"
  | "verifier"

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
  mindmap: { provider: OA, model: env("MODEL_MINDMAP", "gpt-4o-mini"), fallback: "gpt-5-mini" },
  flashcard: { provider: OA, model: env("MODEL_FLASHCARD", "gpt-4o-mini"), fallback: "gpt-5-mini" },
  inquisitor: { provider: OA, model: env("MODEL_INQUISITOR", "gpt-5-mini"), fallback: SAFE },
  case: { provider: OA, model: env("MODEL_CASE", "gpt-5-mini"), fallback: SAFE },
  verifier: {
    provider: DS,
    model: env("MODEL_VERIFIER", "deepseek-chat"),
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
