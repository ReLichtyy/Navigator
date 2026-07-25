import { describe, expect, it } from "vitest"
import { sourceBlocksFromChunks } from "@/lib/server/repositories/source-block.repo"

describe("canonical source blocks", () => {
  it("preserves every extracted locator in stable source order", () => {
    const blocks = sourceBlocksFromChunks([
      { text: "Primera página", pageStart: 1, pageEnd: 1 },
      { text: "Segunda página", pageStart: 2, pageEnd: 2 },
      { text: "Apéndice", pageStart: 12, pageEnd: 12 },
    ])

    expect(blocks).toHaveLength(3)
    expect(blocks.map((block) => block.block_index)).toEqual([0, 1, 2])
    expect(blocks[2]).toMatchObject({
      content: "Apéndice",
      page_start: 12,
      page_end: 12,
      block_type: "text",
    })
    expect(blocks[2].content_hash).toMatch(/^[a-f0-9]{64}$/)
  })
})
