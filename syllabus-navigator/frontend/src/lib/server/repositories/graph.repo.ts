import { sql } from "@/lib/db"

export interface GraphNodeInput {
  externalId: string
  label: string
  weight: number | null
  dependencies: string[] // external ids of prerequisites
}

export interface GraphTopic {
  id: string
  external_id: string
  label: string
  weight_percent: number | null
}

export interface GraphEdge {
  prerequisite_topic_id: string
  target_topic_id: string
  relation_type: string
  confidence: number | null
}

export const GraphRepository = {
  /** Replace the whole graph (topics + dependencies) for a syllabus. */
  async replaceGraph(syllabusId: string, nodes: GraphNodeInput[]): Promise<void> {
    // topic_dependencies cascade-deletes when topics are removed.
    await sql`DELETE FROM topics WHERE syllabus_id = ${syllabusId}::uuid`
    if (nodes.length === 0) return

    const externalToId = new Map<string, string>()
    for (const node of nodes) {
      const rows = await sql`
        INSERT INTO topics (syllabus_id, external_id, label, weight_percent)
        VALUES (${syllabusId}::uuid, ${node.externalId}, ${node.label}, ${node.weight})
        RETURNING id
      `
      externalToId.set(node.externalId, (rows[0] as { id: string }).id)
    }

    for (const node of nodes) {
      const targetId = externalToId.get(node.externalId)!
      for (const depExternalId of node.dependencies) {
        const prereqId = externalToId.get(depExternalId)
        if (!prereqId || prereqId === targetId) continue
        await sql`
          INSERT INTO topic_dependencies
            (syllabus_id, prerequisite_topic_id, target_topic_id, relation_type, confidence)
          VALUES (${syllabusId}::uuid, ${prereqId}::uuid, ${targetId}::uuid, 'prerequisite', 1.000)
          ON CONFLICT (prerequisite_topic_id, target_topic_id, relation_type) DO NOTHING
        `
      }
    }
  },

  async getGraph(syllabusId: string): Promise<{ topics: GraphTopic[]; edges: GraphEdge[] }> {
    const topics = (await sql`
      SELECT id, external_id, label, weight_percent
      FROM topics WHERE syllabus_id = ${syllabusId}::uuid
      ORDER BY created_at ASC
    `) as GraphTopic[]
    const edges = (await sql`
      SELECT prerequisite_topic_id, target_topic_id, relation_type, confidence
      FROM topic_dependencies WHERE syllabus_id = ${syllabusId}::uuid
    `) as GraphEdge[]
    return { topics, edges }
  },
}
