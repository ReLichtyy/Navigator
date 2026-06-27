/**
 * server/rag/chunking.ts — PDF text extraction + chunking.
 *
 * Port of backend/app/utils/chunking.py. Extracts text per page (1-based page
 * numbers) and splits into overlapping windows for embedding.
 */

import { extractText, getDocumentProxy } from "unpdf"
import { parseOfficeAsync } from "officeparser"
import { tmpdir } from "os"
import { mkdtemp, rm } from "fs/promises"
import { join } from "path"

export interface TextChunk {
  text: string
  /** Página 1-based (fuentes PDF). null para link/texto. */
  pageStart: number | null
  pageEnd: number | null
  /** Offset de carácter en el texto fuente (fuentes link/texto). null para PDF. */
  charStart?: number | null
  charEnd?: number | null
}

/** Split long text into overlapping windows. */
export function splitText(text: string, maxLen = 1200, overlap = 120): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.length <= maxLen) return [trimmed]

  const chunks: string[] = []
  let start = 0
  while (start < trimmed.length) {
    const end = Math.min(start + maxLen, trimmed.length)
    chunks.push(trimmed.slice(start, end))
    if (end === trimmed.length) break
    start = Math.max(0, end - overlap)
  }
  return chunks
}

/**
 * Split long text into overlapping windows, tracking the char offset of each
 * window in the (trimmed) source. Used for link/text sources whose citations
 * locate by character range instead of page number.
 */
export function splitTextWithOffsets(
  text: string,
  maxLen = 1200,
  overlap = 120,
): { text: string; start: number; end: number }[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.length <= maxLen) return [{ text: trimmed, start: 0, end: trimmed.length }]

  const out: { text: string; start: number; end: number }[] = []
  let start = 0
  while (start < trimmed.length) {
    const end = Math.min(start + maxLen, trimmed.length)
    out.push({ text: trimmed.slice(start, end), start, end })
    if (end === trimmed.length) break
    start = Math.max(0, end - overlap)
  }
  return out
}

/** Plain text (user-pasted or extracted from a URL) → chunks with char locators. */
export function textToChunks(text: string, maxLen = 1200, overlap = 120): TextChunk[] {
  return splitTextWithOffsets(text, maxLen, overlap).map((w) => ({
    text: w.text,
    pageStart: null,
    pageEnd: null,
    charStart: w.start,
    charEnd: w.end,
  }))
}

/** Extract per-page text from a PDF and split into chunk dicts with page numbers. */
export async function pdfToPageChunks(
  pdfBytes: Uint8Array,
  maxLen = 1200,
  overlap = 120,
): Promise<TextChunk[]> {
  const pdf = await getDocumentProxy(pdfBytes)
  // mergePages: false → text per page, so we can attach page numbers to chunks.
  const { text: pages } = await extractText(pdf, { mergePages: false })

  const out: TextChunk[] = []
  pages.forEach((raw, idx) => {
    const pageText = (raw ?? "").trim()
    if (!pageText) return
    const pageNum = idx + 1
    for (const piece of splitText(pageText, maxLen, overlap)) {
      out.push({ text: piece, pageStart: pageNum, pageEnd: pageNum })
    }
  })
  return out
}

/**
 * Extract text from an Office Open XML file (docx / pptx / xlsx) and split into
 * chunk dicts with char locators (no pages — these formats have no stable page
 * model). Uses officeparser (pure JS, in-process; no native deps).
 */
export async function officeToChunks(
  bytes: Uint8Array,
  maxLen = 1200,
  overlap = 120,
): Promise<TextChunk[]> {
  // officeparser unzips to disk. The default location is relative to cwd (read-only
  // on serverless) AND it cleans up a shared subdir after each parse, which races
  // when two uploads run on the same instance. Give every parse its own temp dir
  // under the OS temp (writable on Vercel: /tmp) and remove it when done.
  const dir = await mkdtemp(join(tmpdir(), "officeparse-"))
  try {
    const text = await parseOfficeAsync(Buffer.from(bytes), {
      tempFilesLocation: dir,
      outputErrorToConsole: false,
    })
    return textToChunks((text ?? "").trim(), maxLen, overlap)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Cap a chunk list to a cumulative character budget, keeping whole chunks from
 * the start (document order). Bounds embedding count and the concatenated text
 * fed to the graph/schedule LLMs, so ingest time stays flat no matter how large
 * the source file is. Returns the original list when already under budget.
 */
export function capChunks(chunks: TextChunk[], maxChars: number): TextChunk[] {
  let total = 0
  const out: TextChunk[] = []
  for (const c of chunks) {
    if (total >= maxChars) break
    out.push(c)
    total += c.text.length
  }
  return out
}

/**
 * Count "meaningful" characters (non-whitespace) across chunks. Used to decide
 * if a PDF carries real digital text or is just a scan with garbage/no text.
 */
export function meaningfulTextLength(chunks: TextChunk[]): number {
  let n = 0
  for (const c of chunks) n += c.text.replace(/\s/g, "").length
  return n
}

export interface ExtractedUrl {
  title: string
  text: string
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
}

/** Minimal HTML → text: drop scripts/styles/tags, decode common entities, collapse whitespace. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|br|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&[a-z]+;|&#39;/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * Fetch a URL and extract clean text + title. No headless browser: server-side
 * fetch + HTML strip, good enough for articles/syllabi pages. Throws on non-OK
 * responses or non-HTML content so the caller can surface a clear error.
 */
export async function fetchUrlText(url: string, maxBytes = 2_000_000): Promise<ExtractedUrl> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "SyllabusNavigator/1.0 (+content-ingest)" },
  })
  if (!res.ok) throw new Error(`No se pudo acceder al enlace (HTTP ${res.status}).`)

  const contentType = res.headers.get("content-type") ?? ""
  if (!/text\/html|text\/plain|application\/xhtml/i.test(contentType)) {
    throw new Error(`Tipo de contenido no soportado para enlaces: ${contentType || "desconocido"}.`)
  }

  const raw = (await res.text()).slice(0, maxBytes)
  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? htmlToText(titleMatch[1]).slice(0, 200) : url
  const text = /text\/plain/i.test(contentType) ? raw.trim() : htmlToText(raw)
  return { title: title || url, text }
}
