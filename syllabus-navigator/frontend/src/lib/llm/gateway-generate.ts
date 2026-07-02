/**
 * llm/gateway-generate.ts — structured JSON generation for the RAG generators
 * (course inference, graph, schedule) via the DIRECT OpenAI API.
 *
 * Formerly ran on the Bluesmind gateway (gpt-5.4), dropped 2026-07-01: every
 * model the gateway lists fails live (503 "no available channel" / 504 / 500 /
 * 403), which silently killed course inference/graph/schedule. OpenAI direct is
 * the replacement — same key as embeddings (OPENAI_API_KEY, always configured).
 *
 * Default model: gpt-5-mini (cheap, strong at big structured JSON). Override
 * per-deploy via MODEL_RAG. Kept the "JSON only" instruct-and-parse contract
 * (plus json_object response_format) so callers are unchanged.
 */
import OpenAI from "openai"
import { isReasoningModel } from "./config"

let _client: OpenAI | null = null
function openaiClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")
    _client = new OpenAI({ apiKey })
  }
  return _client
}

/** The model for every RAG generator. Overridable per-deploy via MODEL_RAG. */
export const RAG_GATEWAY_MODEL = (() => {
  const v = process.env.MODEL_RAG?.trim()
  // gpt-5.4 / gemini-* / deepseek/* were gateway-only ids — 404 on api.openai.com.
  if (!v || /^(gpt-5\.4|gemini|deepseek\/)/.test(v)) return "gpt-5-mini"
  return v
})()

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
 * Generate a JSON string from OpenAI. Instructs "JSON only" + json_object mode;
 * the caller runs extractJson + its own zod parse (contract unchanged from the
 * gateway era, so callers didn't move). Uses RAG_GATEWAY_MODEL unless `model` is
 * given. Transient errors (429/5xx) are retried in-call with a short backoff.
 */
export async function gatewayJson(
  system: string,
  user: string,
  temperature = 0,
  model: string = RAG_GATEWAY_MODEL,
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const completion = await openaiClient().chat.completions.create({
        model,
        // Reasoning models (gpt-5/o-series) reject temperature → omit.
        ...(isReasoningModel(model) ? {} : { temperature }),
        response_format: { type: "json_object" },
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
