/**
 * llm/gateway-generate.ts — structured JSON generation for the RAG generators
 * (course inference, graph, schedule, study) via the BLUESMIND gateway.
 *
 * Why not the direct OpenAI client: these run on gpt-5.4, a gateway-only id.
 * Sending it to api.openai.com 404s (the bug that silently killed course
 * inference/graph/schedule). The gateway is OpenAI-compatible (one key + base
 * URL) — same client the Study Engine agents use.
 *
 * gpt-5.4 is the only model the gateway token currently has access to (deepseek/*
 * and gemini/* return 403 "no access" / 400 "price not configured" until the
 * gateway admin enables them), so all four generators use it. Override per-deploy
 * via MODEL_RAG. The gateway is mixed-vendor → no OpenAI strict json_schema; we
 * instruct "JSON only" and parse the reply, exactly like rag/agents/_base.ts.
 */
import OpenAI from "openai"
import { isReasoningModel } from "./config"

let _gw: OpenAI | null = null
function gateway(): OpenAI {
  if (!_gw) {
    const apiKey = process.env.BLUESMIND_API_KEY
    const baseURL = process.env.BLUESMIND_BASE_URL
    if (!apiKey) throw new Error("BLUESMIND_API_KEY is not configured")
    if (!baseURL) throw new Error("BLUESMIND_BASE_URL is not configured")
    _gw = new OpenAI({ apiKey, baseURL })
  }
  return _gw
}

/** The gateway model for every RAG generator. Overridable per-deploy. */
export const RAG_GATEWAY_MODEL = process.env.MODEL_RAG || "gpt-5.4"

/** Pull a JSON object out of a model reply, tolerating ```json fences / prose. */
export function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) return fenced[1].trim()
  const first = raw.indexOf("{")
  const last = raw.lastIndexOf("}")
  if (first >= 0 && last > first) return raw.slice(first, last + 1)
  return raw.trim()
}

/**
 * True for errors worth retrying: gateway rate limits (429), upstream hiccups
 * (5xx, "no available channel"), or network failures. Permanent errors (bad
 * request, auth) are not retried.
 */
export function isTransientLLMError(err: unknown): boolean {
  const status = (err as { status?: number })?.status
  if (status !== undefined) return status === 429 || status >= 500
  const msg = err instanceof Error ? err.message : String(err)
  return /\b(429|500|502|503|504)\b/.test(msg) || /rate.?limit|overloaded|no available channel|timeout|ECONNRESET|fetch failed/i.test(msg)
}

const RETRY_DELAYS_MS = [1_000, 4_000] // 3 total attempts; short — callers run inside a 60s serverless budget

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Generate a JSON string from the gateway. Instructs "JSON only" (the gateway is
 * mixed-vendor → no strict json_schema); the caller runs extractJson + its own
 * zod parse. Uses RAG_GATEWAY_MODEL unless `model` is given. Transient gateway
 * errors (429/5xx) are retried in-call with a short backoff before surfacing.
 */
export async function gatewayJson(
  system: string,
  user: string,
  temperature = 0,
  model: string = RAG_GATEWAY_MODEL,
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const completion = await gateway().chat.completions.create({
        model,
        // Reasoning models (gpt-5/o-series, deepseek-reasoner) reject temperature → omit.
        ...(isReasoningModel(model) ? {} : { temperature }),
        messages: [
          {
            role: "system",
            content: `${system}\n\nRespond ONLY with a single valid JSON object that matches the requested shape. No prose, no markdown fences.`,
          },
          { role: "user", content: user },
        ],
      })
      return completion.choices[0]?.message?.content ?? "{}"
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length || !isTransientLLMError(err)) throw err
      await sleep(RETRY_DELAYS_MS[attempt])
    }
  }
}
