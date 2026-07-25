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
import { InventoryRepository, type StoredInventory } from "../repositories/inventory.repo"
import { inventoryToGroundedOutline } from "../rag/inventory-gen"

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
  const visibleStatus = row?.status === "failed" && row.data ? "stale" : (row?.status ?? "none")
  return {
    course_id: courseId,
    graph_status: visibleStatus as CourseGraphResponseAPI["graph_status"],
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
      source_refs?: SourceRefAPI[]
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
      const topicRefs =
        topic.source_refs && topic.source_refs.length > 0
          ? topic.source_refs
          : [
              {
                syllabus_id: graph.docId,
                topic_id: topic.id,
                quote: topic.detail ?? topic.label,
              } satisfies SourceRefAPI,
            ]
      const existing = byLabel.get(key)
      if (existing) {
        existing.refs.push(...topicRefs)
        existing.weight = Math.max(existing.weight, Number(topic.weight_percent ?? 0))
      } else {
        byLabel.set(key, {
          id: topic.external_id,
          label: topic.label.trim(),
          weight: Number(topic.weight_percent ?? 0),
          detail: topic.detail ?? null,
          refs: topicRefs,
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

function refsForCourseNode(label: string, inventories: StoredInventory[]): SourceRefAPI[] {
  const needle = label.trim().toLocaleLowerCase()
  const terms = new Set(needle.split(/\s+/).filter((term) => term.length > 2))
  const refs: SourceRefAPI[] = []
  for (const inventory of inventories) {
    const ranked = inventory.data.concepts
      .map((concept) => {
        const candidate = concept.label.trim().toLocaleLowerCase()
        const overlap = candidate.split(/\s+/).filter((term) => terms.has(term)).length
        const score =
          candidate === needle
            ? 100
            : candidate.includes(needle) || needle.includes(candidate)
              ? 50
              : overlap
        return { concept, score }
      })
      .sort((a, b) => b.score - a.score)
    const selected = ranked.filter((item) => item.score > 0).slice(0, 2)
    if (selected.length === 0 && ranked[0]) selected.push(ranked[0])
    for (const { concept } of selected) {
      for (const sourceBlockId of concept.source_block_ids.slice(0, 3)) {
        refs.push({
          syllabus_id: inventory.syllabus_id,
          source_block_id: sourceBlockId,
          source_name: inventory.original_filename,
          quote: concept.summary,
        })
      }
    }
  }
  return refs.slice(0, 6)
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
    input: {
      fileIds: string[]
      focusTopics?: string[]
      instructions?: string
      branchId?: string
      branchMode?: "regenerate" | "expand" | "condense"
    },
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
        branchId: input.branchId ?? "",
        branchMode: input.branchMode ?? "",
      }),
      stage: "preview",
      request: normalizedInput,
    })
    const documentGraphs = await Promise.all(
      docIds.map(async (docId) => ({ docId, ...(await GraphRepository.getGraph(docId)) })),
    )
    const preview = previewFromDocumentGraphs(documentGraphs)
    if (preview.nodes.length > 0) {
      await CourseGraphRepository.savePreview(courseId, preview, docIds, run.id)
    } else {
      await CourseGraphRepository.markProcessing(courseId, docIds, run.id)
    }
    if (run.workflow_run_id && !run.workflow_run_id.startsWith("starting:")) return run
    const claimed = await ArtifactRunRepository.claimDispatch(run.id)
    if (!claimed) return run
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
      await ArtifactRunRepository.releaseDispatchClaim(run.id)
      await ArtifactRunRepository.settle(run.id, "failed", message, true)
      await CourseGraphRepository.markFailed(courseId, message, run.id)
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
    runId?: string,
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

    const inventories = await InventoryRepository.getForDocuments(userId, courseId, docIds)
    const sourceText =
      inventories.length === docIds.length
        ? inventories
            .map(
              (inventory) =>
                `## ${inventory.original_filename}\n${inventoryToGroundedOutline(inventory.data)}`,
            )
            .join("\n\n")
        : await ChunkRepository.getConcatenatedTextByDocs(userId, courseId, docIds)
    const documentGraphs = await Promise.all(docIds.map((docId) => GraphRepository.getGraph(docId)))
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

    try {
      const g = await extractGraphFromText(text, {
        focusTopics: input.focusTopics,
        instructions: input.instructions,
      })
      const colors = assignColors(g.topics)
      const data: CourseGraphData = {
        layout: g.layout,
        nodes: g.topics.map((t) => {
          const sourceRefs = refsForCourseNode(t.label, inventories)
          return {
            id: t.externalId,
            label: t.label,
            weight_percent: t.weight ?? 0,
            level: t.level,
            parent_id: t.parentExternalId,
            detail: t.detail,
            color: colors.get(t.externalId) ?? null,
            source_refs: sourceRefs,
            confidence: sourceRefs.length > 0 ? 0.9 : 0,
            generation_version: 2,
          }
        }),
        edges: g.prerequisites.map((p) => ({ source: p.from, target: p.to })),
        crossLinks: g.crossLinks,
      }
      const saved = await CourseGraphRepository.saveData(courseId, data, runId)
      if (!saved) {
        throw new ApiErrorResponse(
          "Esta generación fue reemplazada por una solicitud más nueva.",
          409,
        )
      }
      await StudyInvalidationService.invalidateCourseGraph(courseId)
      logInfo("course_graph.regenerated", {
        courseId,
        docs: docIds.length,
        nodes: data.nodes.length,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await CourseGraphRepository.markFailed(courseId, msg, runId)
      logError("course_graph.regenerate_error", { courseId, error: msg })
      throw new ApiErrorResponse("No se pudo generar el mapa del curso.", 502)
    }

    return this.getCourseGraph(userId, courseId)
  },

  async refineBranch(
    userId: string,
    courseId: string,
    input: {
      fileIds: string[]
      focusTopics?: string[]
      instructions?: string
      branchId?: string
      branchMode?: "regenerate" | "expand" | "condense"
    },
    runId: string,
  ): Promise<CourseGraphResponseAPI> {
    const course = await CourseRepository.findByIdAndUser(courseId, userId)
    if (!course) throw new ApiErrorResponse("Course not found", 404)
    const existing = await CourseGraphRepository.get(courseId)
    const data = existing?.data
    const branch = data?.nodes.find((node) => node.id === input.branchId)
    if (!data || !branch) throw new ApiErrorResponse("La rama seleccionada ya no existe.", 409)

    const docIds = await processedDocIds(userId, courseId, input.fileIds)
    const inventories = await InventoryRepository.getForDocuments(userId, courseId, docIds)
    if (inventories.length === 0) {
      throw new ApiErrorResponse("La rama aún no tiene un inventario verificable.", 409)
    }
    const evidence = inventories
      .map(
        (inventory) =>
          `## ${inventory.original_filename}\n${inventoryToGroundedOutline(inventory.data)}`,
      )
      .join("\n\n")
    const modeInstruction =
      input.branchMode === "expand"
        ? "Amplía la rama con conceptos y ejemplos adicionales respaldados."
        : input.branchMode === "condense"
          ? "Condensa la rama a sus conceptos esenciales, sin perder prerrequisitos."
          : "Regenera únicamente esta rama con una jerarquía más clara."
    const generated = await extractGraphFromText(evidence, {
      focusTopics: [branch.label],
      instructions: [modeInstruction, input.instructions].filter(Boolean).join(" "),
    })

    const removed = new Set<string>()
    let changed = true
    while (changed) {
      changed = false
      for (const node of data.nodes) {
        if (node.parent_id === branch.id || (node.parent_id && removed.has(node.parent_id))) {
          if (!removed.has(node.id)) {
            removed.add(node.id)
            changed = true
          }
        }
      }
    }
    const prefix = `ref-${runId.slice(0, 8)}-`
    const idMap = new Map(
      generated.topics.map((topic) => [topic.externalId, `${prefix}${topic.externalId}`]),
    )
    const generatedNodes = generated.topics.map((topic) => {
      const refs = refsForCourseNode(topic.label, inventories)
      return {
        id: idMap.get(topic.externalId)!,
        label: topic.label,
        weight_percent: topic.weight ?? 0,
        level: Math.min(4, branch.level + topic.level),
        parent_id: topic.parentExternalId
          ? (idMap.get(topic.parentExternalId) ?? branch.id)
          : branch.id,
        detail: topic.detail,
        color: branch.color,
        source_refs: refs,
        confidence: refs.length > 0 ? 0.9 : 0,
        generation_version: (branch.generation_version ?? 1) + 1,
      }
    })
    const keptNodes = data.nodes
      .filter((node) => !removed.has(node.id))
      .map((node) =>
        node.id === branch.id
          ? { ...node, generation_version: (node.generation_version ?? 1) + 1 }
          : node,
      )
    const next: CourseGraphData = {
      ...data,
      nodes: [...keptNodes, ...generatedNodes],
      edges: [
        ...data.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)),
        ...generated.prerequisites.map((edge) => ({
          source: idMap.get(edge.from) ?? branch.id,
          target: idMap.get(edge.to) ?? branch.id,
        })),
      ].filter((edge) => edge.source !== edge.target),
      crossLinks: data.crossLinks.filter(
        (link) => !removed.has(link.source) && !removed.has(link.target),
      ),
    }
    const saved = await CourseGraphRepository.saveData(courseId, next, runId)
    if (!saved) {
      throw new ApiErrorResponse(
        "Esta generación fue reemplazada por una solicitud más nueva.",
        409,
      )
    }
    await StudyInvalidationService.invalidateCourseGraph(courseId)
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
