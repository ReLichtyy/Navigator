/**
 * study-stage-compose.ts — pure stage-composition helper (no DB/LLM), split out
 * of study.service so it can be unit-tested in isolation.
 *
 * The staged quiz bank is multiple-choice-dominant; a few conex/vf items are
 * seeded per fill batch (see study-bank.service). This reserves a fixed per-stage
 * quota for those alternative kinds and spreads them through the served stage so
 * a stage isn't all MC when the bank has variety.
 */
import type { QuizQuestion } from "../rag/study-gen"

export type StageItem = { id: string; topicKey: string | null; payload: QuizQuestion }

// Per-stage quota for the alternative exercise kinds (AreaEstudio.dc).
export const STAGE_QUOTA: Record<"conex" | "vf" | "order" | "fill", number> = {
  conex: 1,
  vf: 2,
  order: 1,
  fill: 1,
}

const isAltKind = (k: string | undefined): k is keyof typeof STAGE_QUOTA =>
  k === "conex" || k === "vf" || k === "order" || k === "fill"

/**
 * Keep the plan order, but reserve up to `STAGE_QUOTA` items of each alternative
 * kind a slot, spread through the multiple-choice filler. Overflow of a kind past
 * its quota falls back to filler. Pure — returns a new array.
 */
export function composeStageWithQuota(ordered: StageItem[], poolSize: number): StageItem[] {
  const quota = { ...STAGE_QUOTA }
  const picked: StageItem[] = []
  const filler: StageItem[] = []
  for (const it of ordered) {
    const k = it.payload.kind
    if (isAltKind(k) && quota[k] > 0) {
      quota[k]--
      picked.push(it)
    } else {
      filler.push(it)
    }
  }
  if (picked.length === 0) return filler.slice(0, poolSize)
  const out = filler.slice()
  picked.forEach((sp, i) => {
    const at = Math.min(out.length, Math.floor(((i + 1) / (picked.length + 1)) * poolSize))
    out.splice(at, 0, sp)
  })
  return out.slice(0, poolSize)
}
