import { describe, expect, it } from "vitest"
import corpus from "./fixtures/knowledge-golden-corpus.json"
import { evaluateKnowledgeArtifact, percentile } from "@/lib/server/eval/knowledge-metrics"

describe("knowledge golden-corpus harness", () => {
  it("defines at least 15 representative academic cases", () => {
    expect(corpus).toHaveLength(15)
    const kinds = new Set(corpus.map((item) => item.kind))
    for (const kind of ["pdf", "pptx", "xlsx", "scanned_pdf", "course"]) {
      expect(kinds.has(kind)).toBe(true)
    }
  })

  it("measures citation coverage, concept coverage and duplicates", () => {
    const result = evaluateKnowledgeArtifact(
      [
        {
          label: "Objetivos",
          source_refs: [{ syllabus_id: "d1", source_block_id: "b1" }],
        },
        {
          label: "Evaluación",
          source_refs: [{ syllabus_id: "d1", chunk_id: "c1" }],
        },
        { label: "Evaluación", source_refs: [] },
      ],
      ["objetivos", "evaluación", "cronograma"],
    )
    expect(result).toMatchObject({
      conceptCoverage: 2 / 3,
      citationCoverage: 2 / 3,
      duplicateRate: 1 / 3,
      missingConcepts: ["cronograma"],
    })
    expect(percentile([10, 20, 30, 40], 95)).toBe(40)
  })
})
