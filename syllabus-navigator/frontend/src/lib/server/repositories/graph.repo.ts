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

  /**
   * All topics the user owns (across courses) with their prerequisite labels.
   * Used by recommendations to suggest "review first" topics for an assessment.
   */
  async listUserTopicsWithPrereqs(
    userId: string,
  ): Promise<{ syllabus_id: string; label: string; prereqs: string[] }[]> {
    const rows = await sql`
      SELECT t.syllabus_id, t.label,
             array_remove(array_agg(pt.label), NULL) AS prereqs
      FROM topics t
      JOIN syllabus_uploads su ON su.id = t.syllabus_id AND su.user_id = ${userId}
      LEFT JOIN topic_dependencies td ON td.target_topic_id = t.id
      LEFT JOIN topics pt ON pt.id = td.prerequisite_topic_id
      GROUP BY t.syllabus_id, t.label
    `
    return rows as { syllabus_id: string; label: string; prereqs: string[] }[]
  },

  /**
   * Every topic the user owns across all courses, with its course label and id.
   * Powers the cross-course prerequisite graph (Sprint 4).
   */
  async listUserTopics(
    userId: string,
  ): Promise<{ id: string; syllabus_id: string; course: string; label: string; weight_percent: number | null }[]> {
    const rows = await sql`
      SELECT t.id, t.syllabus_id, su.original_filename AS course, t.label, t.weight_percent
      FROM topics t
      JOIN syllabus_uploads su ON su.id = t.syllabus_id AND su.user_id = ${userId}
      ORDER BY su.original_filename ASC, t.created_at ASC
    `
    return rows as { id: string; syllabus_id: string; course: string; label: string; weight_percent: number | null }[]
  },

  /** All prerequisite edges for the user's topics (intra-course), as topic-id pairs. */
  async listUserEdges(userId: string): Promise<{ source: string; target: string }[]> {
    const rows = await sql`
      SELECT td.prerequisite_topic_id AS source, td.target_topic_id AS target
      FROM topic_dependencies td
      JOIN syllabus_uploads su ON su.id = td.syllabus_id AND su.user_id = ${userId}
    `
    return rows as { source: string; target: string }[]
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
