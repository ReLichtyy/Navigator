/**
 * CrossGraphService — multi-syllabus cross-course prerequisite graph (Sprint 4).
 *
 * Combines every course's knowledge graph into one view and infers links between
 * courses: when the SAME concept (normalized topic label) appears in two different
 * courses it becomes a "shared" bridge; intra-course prerequisite edges are kept
 * as-is. The bridges are what let a student see how their courses connect (e.g.
 * "Recursión" taught in both Programación and Estructuras de Datos).
 */
import { GraphRepository } from "../repositories/graph.repo"

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")
const cleanCourse = (f: string) => f.replace(/\.pdf$/i, "")

export interface CrossGraphNode {
  id: string
  label: string
  syllabus_id: string
  course: string
  weight_percent: number
}

export interface CrossGraphEdge {
  source: string
  target: string
  kind: "prerequisite" | "shared"
}

export interface CrossGraph {
  nodes: CrossGraphNode[]
  edges: CrossGraphEdge[]
  /** Distinct courses present, for legend/coloring (in node order). */
  courses: { syllabus_id: string; course: string }[]
}

export const CrossGraphService = {
  async get(userId: string): Promise<CrossGraph> {
    const [topics, intraEdges] = await Promise.all([
      GraphRepository.listUserTopics(userId),
      GraphRepository.listUserEdges(userId),
    ])

    const nodes: CrossGraphNode[] = topics.map((t) => ({
      id: t.id,
      label: t.label,
      syllabus_id: t.syllabus_id,
      course: cleanCourse(t.course),
      weight_percent: t.weight_percent != null ? Number(t.weight_percent) : 0,
    }))

    const nodeIds = new Set(nodes.map((n) => n.id))
    const edges: CrossGraphEdge[] = intraEdges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, kind: "prerequisite" as const }))

    // Cross-course "shared" bridges: same normalized label across different courses.
    const byLabel = new Map<string, CrossGraphNode[]>()
    for (const n of nodes) {
      const k = norm(n.label)
      const arr = byLabel.get(k) ?? []
      arr.push(n)
      byLabel.set(k, arr)
    }
    for (const group of byLabel.values()) {
      if (group.length < 2) continue
      // Link each distinct-course pair once (chain to keep edge count linear).
      for (let i = 0; i < group.length - 1; i++) {
        const a = group[i]
        const b = group[i + 1]
        if (a.syllabus_id === b.syllabus_id) continue
        edges.push({ source: a.id, target: b.id, kind: "shared" })
      }
    }

    const seen = new Set<string>()
    const courses: { syllabus_id: string; course: string }[] = []
    for (const n of nodes) {
      if (seen.has(n.syllabus_id)) continue
      seen.add(n.syllabus_id)
      courses.push({ syllabus_id: n.syllabus_id, course: n.course })
    }

    return { nodes, edges, courses }
  },
}
