import { DocumentRepository } from "../repositories/document.repo"
import { ChunkRepository } from "../repositories/chunk.repo"
import { JobRepository } from "../repositories/job.repo"
import { SourceBlockRepository } from "../repositories/source-block.repo"
import { ApiErrorResponse } from "../utils/auth-helpers"
import {
  pdfToPageChunks,
  officeToChunks,
  textToChunks,
  fetchUrlText,
  meaningfulTextLength,
} from "../rag/chunking"
import { storePdf, delBlob, fetchPrivateBlob } from "../storage/blob"
import { logInfo } from "@/lib/observability/logger"
import type { Role } from "@/lib/auth/rbac"
import crypto from "crypto"

// Vercel serverless caps the request body at ~4.5MB, so files larger than that
// use the client→Blob direct upload path (/api/upload/blob + /api/upload/from-blob).
// Locally the limit is the dev server's. We accept up to 25MB here and preserve
// the complete extracted document for background processing.
const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB
const GUEST_TTL_HOURS = 24

// Below this many non-whitespace chars a PDF is treated as a scan with no usable
// digital text → status 'needs_ocr'; the durable process route then runs OCR.
const MIN_PDF_TEXT_CHARS = 200

const NEEDS_OCR_MESSAGE =
  "PDF escaneado o sin texto digital confiable. El archivo quedó guardado y está " +
  "pendiente del workflow de OCR automático."

export type IngestStatus = "pending" | "needs_ocr"

interface IngestResult {
  id: string
  original_filename: string
  jobId: string | null
  status: IngestStatus
}

const GUEST_EXPIRY = () => new Date(Date.now() + GUEST_TTL_HOURS * 3600 * 1000).toISOString()

// "%PDF-" — the magic signature every PDF starts with (allowing a small leading
// offset, which some valid PDFs have before the header).
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]
// "PK\x03\x04" — ZIP local-file header. Office Open XML files (docx/pptx/xlsx)
// are ZIP archives, so they all start with this.
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

function hasMagicAt(bytes: Uint8Array, magic: number[], maxOffset: number): boolean {
  const limit = Math.min(bytes.length - magic.length, maxOffset)
  for (let off = 0; off <= limit; off++) {
    let match = true
    for (let i = 0; i < magic.length; i++) {
      if (bytes[off + i] !== magic[i]) {
        match = false
        break
      }
    }
    if (match) return true
  }
  return false
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  return hasMagicAt(bytes, PDF_MAGIC, 1024)
}
function hasZipMagic(bytes: Uint8Array): boolean {
  return hasMagicAt(bytes, ZIP_MAGIC, 0)
}

// Accepted Office formats → (sourceType, MIME for blob storage). Client-reported
// MIME is spoofable, so we also accept by filename extension and verify the ZIP
// magic from the real bytes below.
type OfficeKind = "docx" | "pptx" | "xlsx"
const OFFICE_MIME: Record<OfficeKind, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
const OFFICE_BY_MIME: Record<string, OfficeKind> = {
  [OFFICE_MIME.docx]: "docx",
  [OFFICE_MIME.pptx]: "pptx",
  [OFFICE_MIME.xlsx]: "xlsx",
}
// Resolve the ONE canonical type for an upload from its declared MIME + filename.
// Both signals must agree when both are known — a conflict means we can't be sure
// what the file is, so we reject instead of guessing. This keeps a source
// single-typed; the actual parse is still content-driven (unpdf / officeparser
// sniff the format from the bytes), so the extracted text is never mislabeled.
function detectKind(
  mime: string,
  filename: string,
): { kind: "pdf" | OfficeKind } | { error: string } | null {
  if (mime === "application/pdf" || /\.pdf$/i.test(filename)) return { kind: "pdf" }
  const byMime = OFFICE_BY_MIME[mime] ?? null
  const byExt =
    (filename.toLowerCase().match(/\.(docx|pptx|xlsx)$/)?.[1] as OfficeKind | undefined) ?? null
  if (!byMime && !byExt) return null
  if (byMime && byExt && byMime !== byExt) {
    return { error: "El tipo del archivo y su extensión no coinciden." }
  }
  return { kind: byExt ?? byMime! }
}

// Vercel Blob public hostname suffix. We only ingest-from-URL for URLs in our own
// blob store (the token route authorized the client upload), never arbitrary URLs.
const BLOB_HOST_SUFFIX = ".blob.vercel-storage.com"

/**
 * Shared ingest core for both upload paths (multipart and client→Blob):
 *   detect single type → verify magic bytes → parse + cap chunks → store (or reuse
 *   blob url) → persist chunks → enqueue embed job.
 * When `fileUrl` is given the file is already in blob (client upload), so we skip
 * the storePdf step and reuse that URL.
 */
async function ingestBytes(params: {
  userId: string
  role: Role
  bytes: Uint8Array
  filename: string
  declaredMime: string
  fileUrl?: string | null
}): Promise<IngestResult> {
  const { userId, role, bytes, filename, declaredMime } = params

  // Declared MIME/filename is spoofable; magic bytes below are the real check.
  const detected = detectKind(declaredMime, filename)
  if (detected && "error" in detected) {
    throw new ApiErrorResponse(detected.error, 400)
  }
  if (!detected) {
    throw new ApiErrorResponse("Only PDF, Word, PowerPoint and Excel files are allowed.", 400)
  }
  const kind = detected.kind
  const isPdf = kind === "pdf"

  if (isPdf && !hasPdfMagic(bytes)) {
    throw new ApiErrorResponse("This file is not a valid PDF.", 400)
  }
  if (!isPdf && !hasZipMagic(bytes)) {
    throw new ApiErrorResponse("This file is not a valid Office document.", 400)
  }

  const sourceHash = crypto.createHash("sha256").update(bytes).digest("hex")
  const sourceType = kind

  // Parse + chunk now (fast, no network) so the async worker never needs the raw file.
  let chunks
  try {
    chunks = isPdf ? await pdfToPageChunks(bytes) : await officeToChunks(bytes)
  } catch (err) {
    logInfo("document.upload.parse_error", {
      userId,
      sourceType,
      error: err instanceof Error ? err.message : String(err),
    })
    throw new ApiErrorResponse("No se pudo leer el contenido del archivo.", 422)
  }

  const isGuest = role === "guest"
  const contentType = isPdf ? "application/pdf" : OFFICE_MIME[kind as OfficeKind]
  // Reuse the pre-stored blob (client upload), else store now (accounts only).
  const fileUrl =
    params.fileUrl ?? (isGuest ? null : await storePdf(userId, filename, bytes, contentType))
  const expiresAt = isGuest ? GUEST_EXPIRY() : null

  const upload = await DocumentRepository.createUpload(userId, filename, sourceHash, {
    fileUrl,
    expiresAt,
    sourceType,
  })

  // Scanned/image-only PDFs are persisted so the durable OCR workflow can process them.
  // Office files have no scan fallback and are rejected when no text is extractable.
  if (meaningfulTextLength(chunks) < MIN_PDF_TEXT_CHARS) {
    if (isPdf) {
      await DocumentRepository.setStatus(upload.id, "needs_ocr", NEEDS_OCR_MESSAGE)
      logInfo("document.upload.needs_ocr", { userId, isGuest, uploadId: upload.id })
      return { ...upload, jobId: null, status: "needs_ocr" }
    }
    throw new ApiErrorResponse("El archivo no contiene texto legible suficiente.", 422)
  }

  await Promise.all([
    SourceBlockRepository.replaceFromChunks(upload.id, chunks),
    ChunkRepository.replaceChunksText(upload.id, chunks),
  ])
  const jobId = await JobRepository.enqueue("ingest", { syllabusId: upload.id })

  logInfo("document.upload.phase1", {
    userId,
    isGuest,
    uploadId: upload.id,
    sourceType,
    chunks: chunks.length,
    stored: Boolean(fileUrl),
  })

  return { ...upload, jobId, status: "pending" }
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
    if (file.size === 0) {
      throw new ApiErrorResponse("The file is empty.", 400)
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new ApiErrorResponse(
        `File size exceeds the ${MAX_FILE_SIZE / 1024 / 1024}MB limit. ` +
          `(Got ${(file.size / 1024 / 1024).toFixed(2)}MB)`,
        400,
      )
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    // Multipart path: no pre-stored blob; ingestBytes stores it (accounts only).
    return ingestBytes({
      userId,
      role,
      bytes,
      filename: file.name,
      declaredMime: file.type,
    })
  },

  /**
   * Ingest a file the client already uploaded directly to Vercel Blob (the
   * client→Blob path that bypasses the ~4.5MB serverless request-body limit).
   * The blob URL is already our stored copy, so we reuse it as file_url instead
   * of re-uploading. Accounts only (guests don't get blob storage).
   */
  async processUploadFromBlob(
    userId: string,
    role: Role,
    input: { url: string; filename: string; contentType?: string },
  ): Promise<IngestResult> {
    if (role === "guest") {
      throw new ApiErrorResponse("Guests cannot use direct uploads.", 403)
    }
    // Only ingest from our own blob store — never an arbitrary URL (SSRF guard).
    let host = ""
    try {
      host = new URL(input.url).hostname
    } catch {
      throw new ApiErrorResponse("Invalid blob URL.", 400)
    }
    if (!host.endsWith(BLOB_HOST_SUFFIX)) {
      throw new ApiErrorResponse("URL is not a Vercel Blob URL.", 400)
    }

    // Private-store blobs 403 on a plain GET — read with the RW token.
    const res = await fetchPrivateBlob(input.url)
    if (!res || !res.ok) {
      throw new ApiErrorResponse("Could not fetch the uploaded file.", 502)
    }
    const buf = await res.arrayBuffer()
    if (buf.byteLength === 0) {
      throw new ApiErrorResponse("The file is empty.", 400)
    }
    if (buf.byteLength > MAX_FILE_SIZE) {
      // Defense in depth: the token route also caps size at upload time.
      await delBlob(input.url)
      throw new ApiErrorResponse(
        `File size exceeds the ${MAX_FILE_SIZE / 1024 / 1024}MB limit.`,
        400,
      )
    }

    try {
      return await ingestBytes({
        userId,
        role,
        bytes: new Uint8Array(buf),
        filename: input.filename,
        declaredMime: input.contentType ?? "",
        fileUrl: input.url, // already stored in blob by the client upload
      })
    } catch (err) {
      // On any rejection (bad type, unreadable) drop the orphaned blob.
      await delBlob(input.url)
      throw err
    }
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

    // Hash the URL so re-adding the same link updates in place (idempotent).
    const sourceHash = crypto.createHash("sha256").update(`link:${url}`).digest("hex")
    const isGuest = role === "guest"

    const upload = await DocumentRepository.createUpload(userId, title || url, sourceHash, {
      expiresAt: isGuest ? GUEST_EXPIRY() : null,
      sourceType: "link",
      sourceUrl: url,
    })

    const chunks = textToChunks(text)
    await Promise.all([
      SourceBlockRepository.replaceFromChunks(upload.id, chunks),
      ChunkRepository.replaceChunksText(upload.id, chunks),
    ])
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

    // Hash the content so identical pastes dedupe per user.
    const sourceHash = crypto.createHash("sha256").update(`text:${clean}`).digest("hex")
    const isGuest = role === "guest"
    const name = title.trim() || "Nota de texto"

    const upload = await DocumentRepository.createUpload(userId, name, sourceHash, {
      expiresAt: isGuest ? GUEST_EXPIRY() : null,
      sourceType: "text",
    })

    const chunks = textToChunks(clean)
    await Promise.all([
      SourceBlockRepository.replaceFromChunks(upload.id, chunks),
      ChunkRepository.replaceChunksText(upload.id, chunks),
    ])
    const jobId = await JobRepository.enqueue("ingest", { syllabusId: upload.id })

    logInfo("document.text.phase1", { userId, isGuest, uploadId: upload.id })
    return { ...upload, jobId, status: "pending" }
  },
}
