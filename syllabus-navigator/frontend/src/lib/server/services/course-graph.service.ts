import { CourseGraphRepository, type CourseGraphData } from "../repositories/course-graph.repo"
import { CourseRepository } from "../repositories/course.repo"
import { ChunkRepository } from "../repositories/chunk.repo"
import { assignColors, GraphRepository, type LayoutKind } from "../repositories/graph.repo"
import { ApiErrorResponse } from "../utils/auth-helpers"
import { extractGraphFromText, validateNoCycles, validateTree } from "../rag/graph-gen"
import { sql } from "@/lib/db"
import { logError, logInfo } from "@/lib/observability/logger"
import type { GraphUpdateInput } from "../validators/api.schemas"
import type { CourseGraphResponseAPI } from "@/types/api"
import { StudyInvalidationService } from "./study-invalidation.service"
import { ArtifactRunRepository } from "../repositories/artifact-run.repo"
import { ArtifactDispatchService } from "./artifact-dispatch.service"
import type { SourceRefAPI } from "@/types/api"

const EMPTY: CourseGraphData = { layout: "radial", nodes: [], edges: [], crossLinks: [] }

function shape(
  courseId: string,
  row: {
    data: CourseGraphData | null
    preview_data?: CourseGraphData | null
    source_doc_ids: string[]
    status: string
    error: string | null
  } | null,
  generation: CourseGraphResponseAPI["generation"] = null,
): CourseGraphResponseAPI {
  const data = row?.data ?? row?.preview_data ?? null
  return {
    course_id: courseId,
    graph_status: (row?.status ?? "none") as CourseGraphResponseAPI["graph_status"],
    graph_error: row?.error ?? null,
    source_doc_ids: row?.source_doc_ids ?? [],
    layout: data?.layout ?? null,
    nodes: data?.nodes ?? EMPTY.nodes,
    edges: data?.edges ?? EMPTY.edges,
    crossLinks: data?.crossLinks ?? EMPTY.crossLinks,
    generation,
  }
}

async function processedDocIds(userId: string, courseId: string, fileIds: string[]) {
  const rows = (await sql`
    SELECT id FROM syllabus_uploads
    WHERE course_id = ${courseId}::uuid AND user_id = ${userId}
      AND status = 'processed' AND id = ANY(${fileIds}::uuid[])
  `) as { id: string }[]
  return rows.map((row) => row.id)
}

function previewFromDocumentGraphs(
  graphs: {
    docId: string
    topics: {
      id: string
      external_id: string
      label: string
      level: number
      weight_percent?: number | null
      detail?: string | null
    }[]
  }[],
): CourseGraphData {
  const byLabel = new Map<
    string,
    {
      id: string
      label: string
      weight: number
      detail: string | null
      refs: SourceRefAPI[]
    }
  >()
  for (const graph of graphs) {
    for (const topic of graph.topics.filter((item) => item.level === 1)) {
      const key = topic.label.trim().toLocaleLowerCase()
      if (!key) continue
      const ref: SourceRefAPI = {
        syllabus_id: graph.docId,
        topic_id: topic.id,
        quote: topic.detail ?? topic.label,
      }
      const existing = byLabel.get(key)
      if (existing) {
        existing.refs.push(ref)
        existing.weight = Math.max(existing.weight, Number(topic.weight_percent ?? 0))
      } else {
        byLabel.set(key, {
          id: topic.external_id,
          label: topic.label.trim(),
          weight: Number(topic.weight_percent ?? 0),
          detail: topic.detail ?? null,
          refs: [ref],
        })
      }
    }
  }
  const branches = [...byLabel.values()].slice(0, 7)
  const topics = branches.map((topic) => ({
    externalId: topic.id,
    label: topic.label,
    level: 1,
    parentExternalId: null,
    weight: topic.weight,
    detail: topic.detail,
  }))
  const colors = assignColors(topics)
  return {
    layout: "radial",
    nodes: branches.map((topic) => ({
      id: topic.id,
      label: topic.label,
      weight_percent: topic.weight,
      level: 1,
      parent_id: null,
      detail: topic.detail,
      color: colors.get(topic.id) ?? null,
      source_refs: topic.refs,
      confidence: 1,
      generation_version: 1,
    })),
    edges: [],
    crossLinks: [],
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
    const generation = await ArtifactRunRepository.latestForScope(
      userId,
      "course",
      courseId,
      "course_graph",
    ).catch(() => undefined)
    return shape(courseId, row ?? null, generation ?? null)
  },

  async enqueueRegeneration(
    userId: string,
    courseId: string,
    input: { fileIds: string[]; focusTopics?: string[]; instructions?: string },
  ) {
    const course = await CourseRepository.findByIdAndUser(courseId, userId)
    if (!course) throw new ApiErrorResponse("Course not found", 404)
    const docIds = await processedDocIds(userId, courseId, input.fileIds)
    if (docIds.length === 0) {
      throw new ApiErrorResponse(
        "Selecciona al menos un documento procesado del curso para generar el mapa.",
        400,
      )
    }

    const documentGraphs = await Promise.all(
      docIds.map(async (docId) => ({ docId, ...(await GraphRepository.getGraph(docId)) })),
    )
    const preview = previewFromDocumentGraphs(documentGraphs)
    if (preview.nodes.length > 0) {
      await CourseGraphRepository.savePreview(courseId, preview, docIds)
    } else {
      await CourseGraphRepository.markProcessing(courseId, docIds)
    }

    const normalizedInput = { ...input, fileIds: docIds }
    const run = await ArtifactRunRepository.create({
      userId,
      scopeKind: "course",
      scopeId: courseId,
      artifactType: "course_graph",
      fingerprint: JSON.stringify({
        fileIds: [...docIds].sort(),
        focusTopics: input.focusTopics ?? [],
        instructions: input.instructions ?? "",
      }),
      stage: "preview",
      request: normalizedInput,
    })
    try {
      const workflowRunId = await ArtifactDispatchService.dispatchCourseGraph({
        runId: run.id,
        userId,
        courseId,
        input: normalizedInput,
      })
      await ArtifactRunRepository.attachWorkflowRun(run.id, workflowRunId)
      return run
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await ArtifactRunRepository.settle(run.id, "failed", message, true)
      await CourseGraphRepository.markFailed(courseId, message)
      throw new ApiErrorResponse("No se pudo iniciar la generación del mapa.", 502)
    }
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
    const docIds = await processedDocIds(userId, courseId, input.fileIds)
    if (docIds.length === 0) {
      throw new ApiErrorResponse(
        "Selecciona al menos un documento procesado del curso para generar el mapa.",
        400,
      )
    }

    const sourceText = await ChunkRepository.getConcatenatedTextByDocs(userId, courseId, docIds)
    const documentGraphs = await Promise.all(
      docIds.map((docId) => GraphRepository.getGraph(docId)),
    )
    const curatedOutline = documentGraphs
      .flatMap((graph) => graph.topics)
      .map((topic) =>
        [
          "- ",
          topic.label,
          topic.detail ? `: ${topic.detail}` : "",
          topic.weight_percent ? ` (${topic.weight_percent}%)` : "",
        ].join(""),
      )
      .join("\n")
    const text = curatedOutline
      ? `## Estructura curada en Knowledge\n${curatedOutline}\n\n## Material fuente\n${sourceText}`
      : sourceText
    if (!sourceText || sourceText.trim().length < 80) {
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
      await StudyInvalidationService.invalidateCourseGraph(courseId)
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
    await StudyInvalidationService.invalidateCourseGraph(courseId)
    return this.getCourseGraph(userId, courseId)
  },
}
