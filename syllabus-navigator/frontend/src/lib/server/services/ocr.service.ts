import OpenAI from "openai"
import { z } from "zod"
import { extractJson } from "@/lib/llm/rag-generate"
import { DocumentRepository } from "../repositories/document.repo"
import { ChunkRepository } from "../repositories/chunk.repo"
import { SourceBlockRepository } from "../repositories/source-block.repo"
import { JobRepository } from "../repositories/job.repo"
import { fetchPrivateBlob } from "../storage/blob"
import { splitText, type TextChunk } from "../rag/chunking"

const OcrSchema = z.object({
  pages: z.array(
    z.object({
      page: z.number().int().positive(),
      text: z.string(),
    }),
  ),
})

function client(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")
  return new OpenAI({ apiKey })
}

export const OcrService = {
  async extractScannedPdf(syllabusId: string): Promise<number> {
    const document = await DocumentRepository.findById(syllabusId)
    if (!document?.file_url || document.source_type !== "pdf") {
      throw new Error("Scanned PDF has no persisted source file")
    }
    const response = await fetchPrivateBlob(document.file_url)
    if (!response) throw new Error("Could not read the persisted scanned PDF")
    const bytes = Buffer.from(await response.arrayBuffer())
    const result = await client().responses.create({
      model: process.env.MODEL_OCR?.trim() || "gpt-4o",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_file",
              filename: document.original_filename,
              file_data: `data:application/pdf;base64,${bytes.toString("base64")}`,
              detail: "high",
            },
            {
              type: "input_text",
              text:
                "Transcribe every page faithfully, including headings, tables, formulas and diagram labels. " +
                'Return JSON only: {"pages":[{"page":1,"text":"..."}]}. Do not summarize.',
            },
          ],
        },
      ],
    })
    const parsed = OcrSchema.parse(JSON.parse(extractJson(result.output_text)))
    const chunks: TextChunk[] = parsed.pages.flatMap((page) =>
      splitText(page.text).map((text) => ({
        text,
        pageStart: page.page,
        pageEnd: page.page,
      })),
    )
    if (chunks.length === 0) throw new Error("OCR returned no readable pages")
    await Promise.all([
      SourceBlockRepository.replaceFromChunks(syllabusId, chunks),
      ChunkRepository.replaceChunksText(syllabusId, chunks),
    ])
    await DocumentRepository.setStatus(syllabusId, "pending", null)
    await JobRepository.enqueue("ingest", { syllabusId }, { kickIfPending: true })
    return chunks.length
  },
}
