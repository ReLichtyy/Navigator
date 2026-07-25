import { describe, expect, it } from "vitest"
import { packInventoryBlocks } from "@/lib/server/rag/inventory-gen"

describe("document inventory map-reduce", () => {
  it("partitions all source blocks without dropping the tail", () => {
    const blocks = Array.from({ length: 8 }, (_, index) => ({
      id: `b${index}`,
      blockIndex: index,
      content: `${index}:${"x".repeat(90)}`,
      pageStart: index + 1,
      pageEnd: index + 1,
    }))
    const packs = packInventoryBlocks(blocks, 220)
    const ids = packs.flatMap((pack) => pack.map((block) => block.id))

    expect(packs.length).toBeGreaterThan(1)
    expect(ids).toEqual(blocks.map((block) => block.id))
    expect(new Set(ids).size).toBe(blocks.length)
  })
})
