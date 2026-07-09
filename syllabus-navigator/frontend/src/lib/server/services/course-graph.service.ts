import { CourseGraphRepository, type CourseGraphData } from "../repositories/course-graph.repo"
import { CourseRepository } from "../repositories/course.repo"
import { ChunkRepository } from "../repositories/chunk.repo"
import { assignColors, type LayoutKind } from "../repositories/graph.repo"
import { ApiErrorResponse } from "../utils/auth-helpers"
import { extractGraphFromText, validateNoCycles, validateTree } from "../rag/graph-gen"
import { sql } from "@/lib/db"
import { logError, logInfo } from "@/lib/observability/logger"
import type { GraphUpdateInput } from "../validators/api.schemas"
import type { CourseGraphResponseAPI } from "@/types/api"

const EMPTY: CourseGraphData = { layout: "radial", nodes: [], edges: [], crossLinks: [] }

function shape(
  courseId: string,
  row: {
    data: CourseGraphData | null
    source_doc_ids: string[]
    status: string
    error: string | null
  } | null,
): CourseGraphResponseAPI {
  const data = row?.data ?? null
  return {
    course_id: courseId,
    graph_status: (row?.status ?? "none") as CourseGraphResponseAPI["graph_status"],
    graph_error: row?.error ?? null,
    source_doc_ids: row?.source_doc_ids ?? [],
    layout: data?.layout ?? null,
    nodes: data?.nodes ?? EMPTY.nodes,
    edges: data?.edges ?? EMPTY.edges,
    crossLinks: data?.crossLinks ?? EMPTY.crossLinks,
  }
}

export const CourseGraphService = {
  /**
   * Read the whole-course mind map. `graph_status: "none"` means the course
   * has never generated one — the client offers the initial "Generar" CTA.
   */
  async getCourseGraph(userId: string, courseId: string): Promise<CourseGraphResponseAPI> {
    const course = await CourseRepository.findByIdAndUser(courseId, userId)
    if (!course) throw new ApiErrorResponse("Course not found", 404)
    const row = await CourseGraphRepository.get(courseId)
    return shape(courseId, row ?? null)
  },

  /**
   * (Re)generate the course map from the selected documents, optionally biased
   * by focus topics + free-form instructions from the "Editar mapa" drawer.
   * Synchronous (single LLM call, like the whole-course study set) — the row is
   * marked processing first so a concurrent GET reflects the in-flight state,
   * and failed so a crash isn't silently swallowed.
   */
  async regenerate(
    userId: string,
    courseId: string,
    input: { fileIds: string[]; focusTopics?: string[]; instructions?: string },
  ): Promise<CourseGraphResponseAPI> {
    const course = await CourseRepository.findByIdAndUser(courseId, userId)
    if (!course) throw new ApiErrorResponse("Course not found", 404)

    // Keep only ids that are really processed documents of this course.
    const rows = (await sql`
      SELECT id FROM syllabus_uploads
      WHERE course_id = ${courseId}::uuid AND user_id = ${userId}
        AND status = 'processed' AND id = ANY(${input.fileIds}::uuid[])
    `) as { id: string }[]
    const docIds = rows.map((r) => r.id)
    if (docIds.length === 0) {
      throw new ApiErrorResponse(
        "Selecciona al menos un documento procesado del curso para generar el mapa.",
        400,
      )
    }

    const text = await ChunkRepository.getConcatenatedTextByDocs(userId, courseId, docIds)
    if (!text || text.trim().length < 80) {
      throw new ApiErrorResponse(
        "Los documentos seleccionados aún no tienen material indexado suficiente.",
        409,
      )
    }

    await CourseGraphRepository.markProcessing(courseId, docIds)
    try {
      const g = await extractGraphFromText(text, {
        focusTopics: input.focusTopics,
        instructions: input.instructions,
      })
      const colors = assignColors(g.topics)
      const data: CourseGraphData = {
        layout: g.layout,
        nodes: g.topics.map((t) => ({
          id: t.externalId,
          label: t.label,
          weight_percent: t.weight ?? 0,
          level: t.level,
          parent_id: t.parentExternalId,
          detail: t.detail,
          color: colors.get(t.externalId) ?? null,
        })),
        edges: g.prerequisites.map((p) => ({ source: p.from, target: p.to })),
        crossLinks: g.crossLinks,
      }
      await CourseGraphRepository.saveData(courseId, data)
      logInfo("course_graph.regenerated", {
        courseId,
        docs: docIds.length,
        nodes: data.nodes.length,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await CourseGraphRepository.markFailed(courseId, msg)
      logError("course_graph.regenerate_error", { courseId, error: msg })
      throw new ApiErrorResponse("No se pudo generar el mapa del curso.", 502)
    }

    return this.getCourseGraph(userId, courseId)
  },

  /**
   * Replace the course map with a user-edited version (same validation as the
   * per-document PATCH: well-formed tree + acyclic prerequisites). Node colors
   * are re-derived from the palette so branches stay visually consistent.
   */
  async updateCourseGraph(
    userId: string,
    courseId: string,
    input: GraphUpdateInput,
  ): Promise<CourseGraphResponseAPI> {
    const course = await CourseRepository.findByIdAndUser(courseId, userId)
    if (!course) throw new ApiErrorResponse("Course not found", 404)
    const existing = await CourseGraphRepository.get(courseId)

    const ids = new Set(input.nodes.map((n) => n.id))
    const edges = input.edges.filter(
      (e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target,
    )
    const crossLinks = input.crossLinks.filter(
      (c) => ids.has(c.source) && ids.has(c.target) && c.source !== c.target,
    )
    const topics = input.nodes.map((n) => ({
      externalId: n.id,
      label: n.label,
      level: n.level,
      parentExternalId: n.parentId && ids.has(n.parentId) ? n.parentId : null,
      weight: n.weight_percent ?? null,
      detail: n.detail ?? null,
    }))

    try {
      validateTree(
        topics.map((t) => ({ id: t.externalId, level: t.level, parentId: t.parentExternalId })),
      )
    } catch {
      throw new ApiErrorResponse(
        "La jerarquía del mapa es inválida (nivel o rama padre inconsistente).",
        400,
      )
    }
    try {
      validateNoCycles(
        [...ids],
        edges.map((e) => ({ from: e.source, to: e.target })),
      )
    } catch {
      throw new ApiErrorResponse(
        "El grafo tiene un ciclo de prerrequisitos. Quita la dependencia circular.",
        400,
      )
    }

    const colors = assignColors(topics)
    const data: CourseGraphData = {
      layout: (existing?.data?.layout ?? "radial") as LayoutKind,
      nodes: topics.map((t) => ({
        id: t.externalId,
        label: t.label,
        weight_percent: t.weight ?? 0,
        level: t.level,
        parent_id: t.parentExternalId,
        detail: t.detail,
        color: colors.get(t.externalId) ?? null,
      })),
      edges,
      crossLinks,
    }
    await CourseGraphRepository.replaceData(courseId, data)
    return this.getCourseGraph(userId, courseId)
  },
}
