import { DocumentRepository } from "../repositories/document.repo"
import { ChunkRepository } from "../repositories/chunk.repo"
import { JobRepository } from "../repositories/job.repo"
import { ApiErrorResponse } from "../utils/auth-helpers"
import { pdfToPageChunks, textToChunks, fetchUrlText, meaningfulTextLength } from "../rag/chunking"
import { storePdf } from "../storage/blob"
import { logInfo } from "@/lib/observability/logger"
import type { Role } from "@/lib/auth/rbac"
import crypto from "crypto"

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_TEXT_CHARS = 200_000 // ~50k tokens; cap pasted text / fetched pages
const GUEST_TTL_HOURS = 24

// Below this many non-whitespace chars a PDF is treated as a scan with no usable
// digital text → status 'needs_ocr' (OCR is intentionally NOT run; see processUpload).
const MIN_PDF_TEXT_CHARS = 200

const NEEDS_OCR_MESSAGE =
  "PDF escaneado o sin texto digital confiable. OCR automático deshabilitado para " +
  "priorizar costo y estabilidad. El archivo quedó guardado, pendiente de OCR o de " +
  "una versión con texto digital seleccionable."

export type IngestStatus = "pending" | "needs_ocr"

interface IngestResult {
  id: string
  original_filename: string
  jobId: string | null
  status: IngestStatus
}

const GUEST_EXPIRY = () =>
  new Date(Date.now() + GUEST_TTL_HOURS * 3600 * 1000).toISOString()

// "%PDF-" — the magic signature every PDF starts with (allowing a small leading
// offset, which some valid PDFs have before the header).
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]
function hasPdfMagic(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - PDF_MAGIC.length, 1024)
  for (let off = 0; off <= limit; off++) {
    let match = true
    for (let i = 0; i < PDF_MAGIC.length; i++) {
      if (bytes[off + i] !== PDF_MAGIC[i]) {
        match = false
        break
      }
    }
    if (match) return true
  }
  return false
}

export const DocumentService = {
  /**
   * Phase 1 of ingestion (synchronous, in the request):
   *   validate → parse PDF text → chunk → persist chunk text → enqueue embed job.
   *
   * Accounts: PDF is stored in blob (file_url, persistent).
   * Guests: PDF is NOT stored; the upload is ephemeral (expires_at = now + 24h).
   *
   * Returns the new upload id and the enqueued job id (for fire-and-forget trigger).
   */
  async processUpload(userId: string, role: Role, file: File): Promise<IngestResult> {
    // Client-reported MIME is spoofable; we re-check the real bytes below.
    if (file.type !== "application/pdf") {
      throw new ApiErrorResponse("Only PDF files are allowed.", 400)
    }
    if (file.size === 0) {
      throw new ApiErrorResponse("The file is empty.", 400)
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new ApiErrorResponse(
        `File size exceeds the 5MB limit. (Got ${(file.size / 1024 / 1024).toFixed(2)}MB)`,
        400,
      )
    }

    const bytes = new Uint8Array(await file.arrayBuffer())

    // Real type check: a PDF must start with the "%PDF-" magic signature,
    // regardless of the client-reported MIME type or filename.
    if (!hasPdfMagic(bytes)) {
      throw new ApiErrorResponse("This file is not a valid PDF.", 400)
    }

    const sourceHash = crypto.createHash("sha256").update(bytes).digest("hex")

    // Parse + chunk now (fast, no network) so the async worker never needs the raw PDF.
    const chunks = await pdfToPageChunks(bytes)

    const isGuest = role === "guest"
    // Store the PDF (accounts only) BEFORE the text check so even a scan-only PDF
    // stays previewable/replaceable while it waits for OCR.
    const fileUrl = isGuest ? null : await storePdf(userId, file.name, bytes)
    const expiresAt = isGuest ? GUEST_EXPIRY() : null

    const upload = await DocumentRepository.createUpload(userId, file.name, sourceHash, {
      fileUrl,
      expiresAt,
      sourceType: "pdf",
    })

    // Scanned / image-only PDF: no reliable digital text. Persist but DON'T index
    // (no chunks, no embed job). OCR is intentionally disabled here; a future OCR
    // flow can re-chunk + enqueue without touching the retriever, schema or UI.
    if (meaningfulTextLength(chunks) < MIN_PDF_TEXT_CHARS) {
      await DocumentRepository.setStatus(upload.id, "needs_ocr", NEEDS_OCR_MESSAGE)
      logInfo("document.upload.needs_ocr", { userId, isGuest, uploadId: upload.id })
      return { ...upload, jobId: null, status: "needs_ocr" }
    }

    await ChunkRepository.replaceChunksText(upload.id, chunks)
    const jobId = await JobRepository.enqueue("ingest", { syllabusId: upload.id })

    logInfo("document.upload.phase1", {
      userId,
      isGuest,
      uploadId: upload.id,
      chunks: chunks.length,
      stored: Boolean(fileUrl),
    })

    return { ...upload, jobId, status: "pending" }
  },

  /**
   * Ingest a web link: fetch the page, extract clean text, chunk + enqueue embed.
   * Reuses the same chunks/jobs/worker pipeline as PDFs — only the text source
   * differs. Guests allowed (ephemeral, 24h); no blob (the URL is the source).
   */
  async processLink(userId: string, role: Role, url: string): Promise<IngestResult> {
    const { title, text } = await fetchUrlText(url)
    if (text.replace(/\s/g, "").length < MIN_PDF_TEXT_CHARS) {
      throw new ApiErrorResponse("El enlace no contiene texto legible suficiente.", 422)
    }

    const clipped = text.slice(0, MAX_TEXT_CHARS)
    // Hash the URL so re-adding the same link updates in place (idempotent).
    const sourceHash = crypto.createHash("sha256").update(`link:${url}`).digest("hex")
    const isGuest = role === "guest"

    const upload = await DocumentRepository.createUpload(userId, title || url, sourceHash, {
      expiresAt: isGuest ? GUEST_EXPIRY() : null,
      sourceType: "link",
      sourceUrl: url,
    })

    await ChunkRepository.replaceChunksText(upload.id, textToChunks(clipped))
    const jobId = await JobRepository.enqueue("ingest", { syllabusId: upload.id })

    logInfo("document.link.phase1", { userId, isGuest, uploadId: upload.id, url })
    return { ...upload, jobId, status: "pending" }
  },

  /**
   * Ingest user-pasted text. No parsing — straight to chunk + enqueue embed.
   * Guests allowed (ephemeral, 24h).
   */
  async processText(
    userId: string,
    role: Role,
    title: string,
    text: string,
  ): Promise<IngestResult> {
    const clean = text.trim()
    if (clean.replace(/\s/g, "").length < MIN_PDF_TEXT_CHARS) {
      throw new ApiErrorResponse("El texto es demasiado corto para indexar.", 422)
    }

    const clipped = clean.slice(0, MAX_TEXT_CHARS)
    // Hash the content so identical pastes dedupe per user.
    const sourceHash = crypto.createHash("sha256").update(`text:${clipped}`).digest("hex")
    const isGuest = role === "guest"
    const name = title.trim() || "Nota de texto"

    const upload = await DocumentRepository.createUpload(userId, name, sourceHash, {
      expiresAt: isGuest ? GUEST_EXPIRY() : null,
      sourceType: "text",
    })

    await ChunkRepository.replaceChunksText(upload.id, textToChunks(clipped))
    const jobId = await JobRepository.enqueue("ingest", { syllabusId: upload.id })

    logInfo("document.text.phase1", { userId, isGuest, uploadId: upload.id })
    return { ...upload, jobId, status: "pending" }
  },
}
