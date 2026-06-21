import { GraphRepository } from "../repositories/graph.repo"
import { DocumentRepository } from "../repositories/document.repo"
import { JobRepository } from "../repositories/job.repo"
import { ApiErrorResponse } from "../utils/auth-helpers"
import type { GraphResponseAPI } from "@/types/api"

export const GraphService = {
  /**
   * Read the knowledge graph for a syllabus the user owns, shaped for the UI.
   * topics → nodes, topic_dependencies (prerequisite → target) → edges.
   * graph_status / graph_error come from the syllabus_uploads row.
   */
  async getGraph(userId: string, syllabusId: string): Promise<GraphResponseAPI> {
    const doc = await DocumentRepository.findByIdAndUser(syllabusId, userId)
    if (!doc) {
      throw new ApiErrorResponse("Syllabus not found", 404)
    }

    const { topics, edges } = await GraphRepository.getGraph(syllabusId)

    return {
      syllabus_id: syllabusId,
      graph_status: doc.graph_status as GraphResponseAPI["graph_status"],
      graph_error: doc.graph_error ?? null,
      nodes: topics.map((t) => ({
        id: t.id,
        label: t.label,
        weight_percent: t.weight_percent ?? 0,
      })),
      edges: edges.map((e) => ({
        source: e.prerequisite_topic_id,
        target: e.target_topic_id,
      })),
    }
  },

  /**
   * Re-run graph generation by re-enqueuing the ingest job. The chunk text is
   * already in Neon, so the worker re-embeds (if needed) and regenerates topics.
   * Marks graph_status='pending' so the UI reflects the in-flight state.
   * Returns the current (pending) graph. Caller triggers the worker.
   */
  async reprocess(userId: string, syllabusId: string): Promise<GraphResponseAPI> {
    const doc = await DocumentRepository.findByIdAndUser(syllabusId, userId)
    if (!doc) {
      throw new ApiErrorResponse("Syllabus not found", 404)
    }

    await DocumentRepository.setGraphStatus(syllabusId, "pending", null)
    await JobRepository.enqueue("ingest", { syllabusId })

    return this.getGraph(userId, syllabusId)
  },
}
