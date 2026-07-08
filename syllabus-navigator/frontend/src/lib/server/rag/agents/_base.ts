/**
 * server/rag/agents/_base.ts — shared structured-output executor for agents.
 *
 * Each agent is a focused role with evidence-grounded input and a typed,
 * zod-validated output. OpenAI roles use strict json_schema; OpenRouter roles
 * (Claude/Gemini) get a "JSON only" instruction and the output is parsed. On
 * failure the role's fallback model is tried once; returns null if both fail.
 */
import OpenAI from "openai"
import type { z } from "zod"
import { chatCompletion } from "@/lib/llm"
import { isNextGenModel } from "@/lib/llm/config"
import { resolveAgentModel, type AgentRole, type AgentProvider } from "@/lib/llm/agent-models"
import { logError } from "@/lib/observability/logger"

let _client: OpenAI | null = null
function client(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")
    _client = new OpenAI({ apiKey })
  }
  return _client
}

/** Pull a JSON object out of a model reply, tolerating ```json fences / prose. */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) return fenced[1].trim()
  const first = raw.indexOf("{")
  const last = raw.lastIndexOf("}")
  if (first >= 0 && last > first) return raw.slice(first, last + 1)
  return raw.trim()
}

export interface AgentCall<T> {
  role: AgentRole
  system: string
  user: string
  schema: z.ZodType<T>
  /** Strict JSON schema for the OpenAI structured-output path. */
  jsonSchema: Record<string, unknown>
  schemaName: string
  temperature?: number
}

async function callOnce(
  provider: AgentProvider,
  model: string,
  c: AgentCall<unknown>,
): Promise<string> {
  if (provider === "openai") {
    const completion = await client().chat.completions.create({
      model,
      ...(isNextGenModel(model) ? {} : { temperature: c.temperature ?? 0.6 }),
      messages: [
        { role: "system", content: c.system },
        { role: "user", content: c.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: c.schemaName, strict: true, schema: c.jsonSchema },
      },
    })
    return completion.choices[0]?.message?.content ?? "{}"
  }
  // OpenRouter (Claude/Gemini/…): no strict schema → instruct + parse.
  const res = await chatCompletion(
    [
      {
        role: "system",
        content: `${c.system}\n\nRespond ONLY with a single valid JSON object that matches the requested shape. No prose, no markdown fences.`,
      },
      { role: "user", content: c.user },
    ],
    { provider, model, temperature: c.temperature ?? 0.6 },
  )
  return res.content
}

/** Run an agent call; returns the validated object or null. */
export async function runAgent<T>(c: AgentCall<T>): Promise<T | null> {
  const { provider, model, fallback, fallbackProvider } = resolveAgentModel(c.role)
  try {
    const raw = await callOnce(provider, model, c)
    const parsed = c.schema.safeParse(JSON.parse(extractJson(raw)))
    if (parsed.success) return parsed.data
    throw new Error("schema validation failed")
  } catch (err) {
    logError("rag.agent.error", {
      role: c.role,
      model,
      error: err instanceof Error ? err.message : String(err),
    })
    if (!fallback) return null
    try {
      // Fallback runs through its own provider (e.g. DeepSeek verifier → OpenAI gpt-5-mini).
      const raw = await callOnce(fallbackProvider ?? provider, fallback, c)
      const parsed = c.schema.safeParse(JSON.parse(extractJson(raw)))
      return parsed.success ? parsed.data : null
    } catch (err2) {
      logError("rag.agent.fallback_error", {
        role: c.role,
        fallback,
        error: err2 instanceof Error ? err2.message : String(err2),
      })
      return null
    }
  }
}
