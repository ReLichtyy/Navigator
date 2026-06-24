/**
 * server/rag/graph-gen.ts — extract a topic/prerequisite graph from syllabus text.
 *
 * Port of backend/app/services/graph_gen.py: OpenAI structured output (JSON schema)
 * + cycle validation (DFS) before persistence.
 */

import OpenAI from "openai"
import { z } from "zod"
import { DEFAULT_MODEL, isNextGenModel } from "@/lib/llm/config"
import { logError } from "@/lib/observability/logger"
import type { GraphNodeInput } from "../repositories/graph.repo"

const SyllabusGraphSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      weight: z.number(),
      dependencies: z.array(z.string()),
    }),
  ),
})

type SyllabusGraph = z.infer<typeof SyllabusGraphSchema>

// Hand-written JSON Schema for OpenAI strict structured outputs (all properties
// required, additionalProperties:false). Mirrors SyllabusGraphSchema above.
const SYLLABUS_GRAPH_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", description: "Short stable id, e.g. 't1'" },
          label: { type: "string", description: "Human-readable topic name" },
          weight: { type: "number", description: "Relative importance 0-100; 0 if unknown" },
          dependencies: {
            type: "array",
            items: { type: "string" },
            description: "ids of prerequisite topics",
          },
        },
        required: ["id", "label", "weight", "dependencies"],
      },
    },
  },
  required: ["nodes"],
} as const

const SYSTEM_PROMPT =
  "You are an expert at extracting learning paths and prerequisite graphs from syllabus " +
  "documents. Identify key topics, assign each a short id and a label, estimate a weight " +
  "(0-100) for its relative importance, and list its dependencies (ids of prerequisite " +
  "topics). Avoid circular dependencies."

let _client: OpenAI | null = null
function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")
    _client = new OpenAI({ apiKey })
  }
  return _client
}

/** Detects a cycle in the dependency graph; throws if found (matches Python behavior). */
export function validateNoCycles(nodes: SyllabusGraph["nodes"]): void {
  const lookup = new Map(nodes.map((n) => [n.id, n]))
  const visited = new Set<string>()
  const path = new Set<string>()

  const visit = (id: string): boolean => {
    if (path.has(id)) return false
    if (visited.has(id)) return true
    path.add(id)
    const node = lookup.get(id)
    if (node) {
      for (const dep of node.dependencies) {
        if (!visit(dep)) return false
      }
    }
    path.delete(id)
    visited.add(id)
    return true
  }

  for (const node of nodes) {
    if (!visit(node.id)) throw new Error(`Cycle detected at node: ${node.id}`)
  }
}

/** Extract topics + prerequisites from syllabus text. */
export async function extractGraphFromText(syllabusText: string): Promise<GraphNodeInput[]> {
  const client = getClient()
  try {
    const completion = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      // GPT-5/o-series reject non-default temperature → omit it for those (BUG-001).
      ...(isNextGenModel(DEFAULT_MODEL) ? {} : { temperature: 0 }),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Extract the topic graph from the following syllabus text:\n\n${syllabusText}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "syllabus_graph",
          strict: true,
          schema: SYLLABUS_GRAPH_JSON_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    })

    const raw = completion.choices[0]?.message?.content ?? "{}"
    const parsed = SyllabusGraphSchema.parse(JSON.parse(raw))
    validateNoCycles(parsed.nodes)

    return parsed.nodes.map((n) => ({
      externalId: n.id,
      label: n.label,
      weight: Number.isFinite(n.weight) ? n.weight : null,
      dependencies: n.dependencies,
    }))
  } catch (err) {
    logError("rag.graph_gen.error", { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}
