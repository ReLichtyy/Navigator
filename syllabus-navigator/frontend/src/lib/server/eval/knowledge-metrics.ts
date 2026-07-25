import type { SourceRefAPI } from "@/types/api"

export interface EvaluatedNode {
  label: string
  source_refs?: SourceRefAPI[]
}

const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .trim()

export function evaluateKnowledgeArtifact(nodes: EvaluatedNode[], expected: string[]) {
  const labels = nodes.map((node) => normalize(node.label))
  const covered = expected.filter((concept) => {
    const needle = normalize(concept)
    return labels.some((label) => label.includes(needle) || needle.includes(label))
  })
  const duplicateLabels = labels.length - new Set(labels).size
  const cited = nodes.filter((node) =>
    node.source_refs?.some((ref) => Boolean(ref.source_block_id || ref.chunk_id)),
  ).length
  return {
    conceptCoverage: expected.length === 0 ? 1 : covered.length / expected.length,
    citationCoverage: nodes.length === 0 ? 1 : cited / nodes.length,
    duplicateRate: nodes.length === 0 ? 0 : duplicateLabels / nodes.length,
    missingConcepts: expected.filter((concept) => !covered.includes(concept)),
  }
}

export function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.ceil((Math.min(100, Math.max(0, percentileValue)) / 100) * sorted.length) - 1
  return sorted[Math.max(0, index)]
}
