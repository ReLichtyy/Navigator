import { sql } from "@/lib/db"

export type LayoutKind = "radial" | "tree_horizontal" | "tree_vertical" | "columns_report"

// Branch palette (green / blue / purple / amber / pink / teal). Color is
// assigned server-side at persist time (see assignColors below) so the mapping
// is stable across sessions; the client just renders node.color.
const PALETTE = ["#5BE39A", "#6FB6F0", "#C9A0F0", "#F0C27C", "#E89BC0", "#8FE0D6"]

export interface GraphNodeInput {
  externalId: string
  label: string
  level: number
  parentExternalId: string | null
  weight: number | null
  detail: string | null
}

export interface GraphPrereqInput {
  from: string // external id
  to: string // external id
}

export interface GraphCrossLinkInput {
  source: string // external id
  target: string // external id
  label: string
}

export interface ReplaceGraphInput {
  topics: GraphNodeInput[]
  prerequisites: GraphPrereqInput[]
  crossLinks: GraphCrossLinkInput[]
  layout: LayoutKind
}

export interface GraphTopic {
  id: string
  external_id: string
  label: string
  weight_percent: number | null
  level: number
  parent_topic_id: string | null
  color: string | null
  detail: string | null
}

export interface GraphEdge {
  prerequisite_topic_id: string
  target_topic_id: string
  relation_type: string
  confidence: number | null
}

export interface GraphCrossLink {
  source_topic_id: string
  target_topic_id: string
  label: string
}

/**
 * Assign a color per topic: level-1 nodes get PALETTE[index-among-siblings],
 * every descendant inherits its level-1 ancestor's color. Never LLM output —
 * keeps color assignment deterministic and independent of prompt drift.
 * Exported for the course-graph service (JSONB graphs reuse the same palette).
 */
export function assignColors(topics: GraphNodeInput[]): Map<string, string> {
  const byExternalId = new Map(topics.map((t) => [t.externalId, t]))
  const colorByExternalId = new Map<string, string>()

  const roots = topics.filter((t) => t.parentExternalId === null)
  roots.forEach((root, i) => colorByExternalId.set(root.externalId, PALETTE[i % PALETTE.length]))

  const childrenOf = new Map<string, GraphNodeInput[]>()
  for (const t of topics) {
    if (t.parentExternalId === null) continue
    const siblings = childrenOf.get(t.parentExternalId) ?? []
    siblings.push(t)
    childrenOf.set(t.parentExternalId, siblings)
  }

  const queue = [...roots]
  while (queue.length > 0) {
    const node = queue.shift()!
    const color = colorByExternalId.get(node.externalId)
    if (!color) continue
    for (const child of childrenOf.get(node.externalId) ?? []) {
      if (!byExternalId.has(child.externalId)) continue
      colorByExternalId.set(child.externalId, color)
      queue.push(child)
    }
  }

  return colorByExternalId
}

export const GraphRepository = {
  /** Replace the whole graph (tree + prerequisites + cross-links + layout) for a syllabus. */
  async replaceGraph(syllabusId: string, input: ReplaceGraphInput): Promise<void> {
    // topic_dependencies and topic_cross_links cascade-delete when topics are removed.
    await sql`DELETE FROM topics WHERE syllabus_id = ${syllabusId}::uuid`

    const { topics, prerequisites, crossLinks, layout } = input
    if (topics.length === 0) {
      await sql`UPDATE syllabus_uploads SET layout = ${layout} WHERE id = ${syllabusId}::uuid`
      return
    }

    const colorByExternalId = assignColors(topics)

    const topicValues: string[] = []
    const topicParams: unknown[] = []
    let tp = 1
    topics.forEach((t, i) => {
      topicValues.push(
        `($${tp++}::uuid, $${tp++}, $${tp++}, $${tp++}, $${tp++}, $${tp++}, $${tp++}, $${tp++})`,
      )
      topicParams.push(
        syllabusId,
        t.externalId,
        t.label,
        t.level,
        t.weight,
        t.detail,
        colorByExternalId.get(t.externalId) ?? null,
        i,
      )
    })
    const insertTopicsText = `
      INSERT INTO topics (syllabus_id, external_id, label, level, weight_percent, description, color, sort_order)
      VALUES ${topicValues.join(", ")}
      RETURNING id, external_id
    `
    const inserted = (await sql.query(insertTopicsText, topicParams)) as {
      id: string
      external_id: string
    }[]
    const externalToId = new Map(inserted.map((r) => [r.external_id, r.id]))

    const parentPairs = topics
      .filter((t) => t.parentExternalId !== null)
      .map((t) => ({
        childId: externalToId.get(t.externalId),
        parentId: t.parentExternalId ? externalToId.get(t.parentExternalId) : undefined,
      }))
      .filter((p) => p.childId && p.parentId && p.childId !== p.parentId)
    if (parentPairs.length > 0) {
      const pv: string[] = []
      const pp: unknown[] = []
      let pi = 1
      for (const p of parentPairs) {
        pv.push(`($${pi++}::uuid, $${pi++}::uuid)`)
        pp.push(p.childId, p.parentId)
      }
      await sql.query(
        `UPDATE topics AS t SET parent_topic_id = v.pid
         FROM (VALUES ${pv.join(", ")}) AS v(id, pid)
         WHERE t.id = v.id`,
        pp,
      )
    }

    const prereqPairs = prerequisites
      .map((e) => ({ prereqId: externalToId.get(e.from), targetId: externalToId.get(e.to) }))
      .filter((e) => e.prereqId && e.targetId && e.prereqId !== e.targetId)
    if (prereqPairs.length > 0) {
      const ev: string[] = []
      const ep: unknown[] = []
      let ei = 1
      for (const e of prereqPairs) {
        ev.push(`($${ei++}::uuid, $${ei++}::uuid, $${ei++}::uuid, 'prerequisite', 1.000)`)
        ep.push(syllabusId, e.prereqId, e.targetId)
      }
      await sql.query(
        `INSERT INTO topic_dependencies
           (syllabus_id, prerequisite_topic_id, target_topic_id, relation_type, confidence)
         VALUES ${ev.join(", ")}
         ON CONFLICT (prerequisite_topic_id, target_topic_id, relation_type) DO NOTHING`,
        ep,
      )
    }

    const seenLinkPairs = new Set<string>()
    const linkRows = crossLinks
      .map((c) => ({
        sourceId: externalToId.get(c.source),
        targetId: externalToId.get(c.target),
        label: c.label,
      }))
      .filter((c) => {
        if (!c.sourceId || !c.targetId || c.sourceId === c.targetId) return false
        const key = `${c.sourceId}:${c.targetId}`
        if (seenLinkPairs.has(key)) return false
        seenLinkPairs.add(key)
        return true
      })
    if (linkRows.length > 0) {
      const cv: string[] = []
      const cp: unknown[] = []
      let ci = 1
      for (const c of linkRows) {
        cv.push(`($${ci++}::uuid, $${ci++}::uuid, $${ci++}::uuid, $${ci++})`)
        cp.push(syllabusId, c.sourceId, c.targetId, c.label)
      }
      await sql.query(
        `INSERT INTO topic_cross_links (syllabus_id, source_topic_id, target_topic_id, label)
         VALUES ${cv.join(", ")}
         ON CONFLICT (source_topic_id, target_topic_id) DO NOTHING`,
        cp,
      )
    }

    await sql`UPDATE syllabus_uploads SET layout = ${layout} WHERE id = ${syllabusId}::uuid`
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
   * All topic labels the user owns, tagged with their course (null course_id =
   * "sin curso"). Powers the Knowledge "Archivo de temas". Labels are
   * de-duplicated per course in SQL; ordering is course name then label.
   */
  async listUserTopicsByCourse(
    userId: string,
  ): Promise<
    { course_id: string | null; course_name: string | null; course_color: string | null; label: string }[]
  > {
    const rows = await sql`
      SELECT DISTINCT c.id AS course_id, c.name AS course_name, c.color AS course_color, t.label
      FROM topics t
      JOIN syllabus_uploads su ON su.id = t.syllabus_id AND su.user_id = ${userId}
      LEFT JOIN courses c ON c.id = su.course_id
      WHERE t.level = 1 -- solo temas de título (ramas principales), no cada sub-nodo del mapa
      ORDER BY c.name ASC NULLS LAST, t.label ASC
    `
    return rows as {
      course_id: string | null
      course_name: string | null
      course_color: string | null
      label: string
    }[]
  },

  async getGraph(
    syllabusId: string,
  ): Promise<{ topics: GraphTopic[]; edges: GraphEdge[]; crossLinks: GraphCrossLink[] }> {
    const topics = (await sql`
      SELECT id, external_id, label, weight_percent, level, parent_topic_id, color,
             description AS detail
      FROM topics WHERE syllabus_id = ${syllabusId}::uuid
      ORDER BY level ASC, sort_order ASC, created_at ASC
    `) as GraphTopic[]
    const edges = (await sql`
      SELECT prerequisite_topic_id, target_topic_id, relation_type, confidence
      FROM topic_dependencies WHERE syllabus_id = ${syllabusId}::uuid
    `) as GraphEdge[]
    const crossLinks = (await sql`
      SELECT source_topic_id, target_topic_id, label
      FROM topic_cross_links WHERE syllabus_id = ${syllabusId}::uuid
    `) as GraphCrossLink[]
    return { topics, edges, crossLinks }
  },
}
