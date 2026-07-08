/**
 * server/rag/graph-gen.ts — extract a topic/prerequisite graph from syllabus text.
 *
 * Port of backend/app/services/graph_gen.py: OpenAI structured output (JSON schema)
 * + cycle validation (DFS) before persistence.
 */

import { z } from "zod"
import { ragJson, extractJson } from "@/lib/llm/rag-generate"
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

const SYSTEM_PROMPT =
  "You are an expert at extracting learning paths and prerequisite graphs from syllabus " +
  "documents. Identify key topics, assign each a short id and a label, estimate a weight " +
  "(0-100) for its relative importance, and list its dependencies (ids of prerequisite " +
  "topics). Avoid circular dependencies.\n\n" +
  'JSON shape: {"nodes":[{"id":string,"label":string,"weight":number,"dependencies":string[]}]}'

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
  try {
    // Cap the prompt so a large document doesn't make this call slow/costly.
    // ~15k tokens covers a syllabus' structure; the graph is an overview map.
    const raw = await ragJson(
      SYSTEM_PROMPT,
      `Extract the topic graph from the following syllabus text:\n\n${syllabusText.slice(0, 60_000)}`,
    )
    const parsed = SyllabusGraphSchema.parse(JSON.parse(extractJson(raw)))
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
