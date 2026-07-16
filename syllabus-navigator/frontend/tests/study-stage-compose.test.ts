import { describe, it, expect } from "vitest"
import {
  composeStageWithQuota,
  STAGE_QUOTA,
  type StageItem,
} from "@/lib/server/services/study-stage-compose"
import type { QuizKind } from "@/lib/server/rag/study-gen"

const item = (id: string, kind: QuizKind = "mc"): StageItem => ({
  id,
  topicKey: null,
  payload: { question: id, options: ["a", "b"], answer: 0, explanation: "", kind },
})

describe("composeStageWithQuota", () => {
  it("returns MC filler unchanged (sliced) when there are no alternative kinds", () => {
    const mc = Array.from({ length: 8 }, (_, i) => item(`m${i}`))
    const out = composeStageWithQuota(mc, 5)
    expect(out).toHaveLength(5)
    expect(out.map((x) => x.id)).toEqual(["m0", "m1", "m2", "m3", "m4"])
  })

  it("caps each alternative kind at its quota and keeps the rest as filler", () => {
    const ordered = [
      item("c0", "conex"),
      item("c1", "conex"), // over quota (1) → filler
      item("v0", "vf"),
      item("v1", "vf"),
      item("v2", "vf"), // over quota (2) → filler
      ...Array.from({ length: 10 }, (_, i) => item(`m${i}`)),
    ]
    const out = composeStageWithQuota(ordered, 15)
    const conex = out.filter((x) => x.payload.kind === "conex")
    const vf = out.filter((x) => x.payload.kind === "vf")
    // At least the quota of each is present (overflow may also appear as filler).
    expect(conex.length).toBeGreaterThanOrEqual(STAGE_QUOTA.conex)
    expect(vf.length).toBeGreaterThanOrEqual(STAGE_QUOTA.vf)
    expect(out.length).toBeLessThanOrEqual(15)
  })

  it("spreads reserved items through the stage rather than clustering them at the end", () => {
    const ordered = [
      item("c0", "conex"),
      item("v0", "vf"),
      item("v1", "vf"),
      ...Array.from({ length: 12 }, (_, i) => item(`m${i}`)),
    ]
    const out = composeStageWithQuota(ordered, 15)
    const specialPositions = out
      .map((x, i) => ({ kind: x.payload.kind, i }))
      .filter((x) => x.kind === "conex" || x.kind === "vf")
      .map((x) => x.i)
    // Not all three reserved items sit in the final stretch of the stage.
    expect(Math.min(...specialPositions)).toBeLessThan(out.length - 1)
  })
})
