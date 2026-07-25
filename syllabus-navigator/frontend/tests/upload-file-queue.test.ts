import { describe, expect, it } from "vitest"
import {
  MAX_FILES_PER_UPLOAD,
  appendFilesToQueue,
  fileQueueKey,
  filesRemainingAfterUpload,
  getUploadFileValidationError,
} from "@/lib/ui/upload-file-queue"

function candidate(name: string, size = 1, lastModified = 1) {
  return { name, size, lastModified }
}

describe("knowledge upload file queue", () => {
  it("appends later selections after the files already selected", () => {
    const first = candidate("programa.pdf")
    const second = candidate("clase.docx")

    const result = appendFilesToQueue([first], [second])

    expect(result.files).toEqual([first, second])
    expect(result.duplicates).toEqual([])
    expect(result.excess).toEqual([])
  })

  it("does not add the same local file twice", () => {
    const file = candidate("programa.pdf", 42, 123)

    const result = appendFilesToQueue([file], [file])

    expect(result.files).toEqual([file])
    expect(result.duplicates).toEqual([file])
  })

  it("caps each upload confirmation at ten files", () => {
    const selected = Array.from({ length: MAX_FILES_PER_UPLOAD + 2 }, (_, index) =>
      candidate(`archivo-${index}.pdf`, index + 1),
    )

    const result = appendFilesToQueue([], selected)

    expect(result.files).toHaveLength(MAX_FILES_PER_UPLOAD)
    expect(result.excess).toEqual(selected.slice(MAX_FILES_PER_UPLOAD))
  })

  it("uses file metadata for a stable queue identity", () => {
    expect(fileQueueKey(candidate("programa.pdf", 42, 123))).toBe("programa.pdf:42:123")
  })

  it("rejects unsupported, empty and oversized files before they enter the queue", () => {
    expect(getUploadFileValidationError(candidate("notas.txt"))).toContain("solo PDF")
    expect(getUploadFileValidationError(candidate("vacio.pdf", 0))).toContain("vacío")
    expect(getUploadFileValidationError(candidate("grande.pdf", 25 * 1024 * 1024 + 1))).toContain(
      "25MB",
    )
    expect(getUploadFileValidationError(candidate("programa.pdf", 1024))).toBeNull()
  })

  it("keeps failed or skipped files available for another attempt", () => {
    const uploaded = candidate("subido.pdf", 1, 1)
    const failed = candidate("pendiente.pdf", 2, 2)

    expect(
      filesRemainingAfterUpload([uploaded, failed], new Set([fileQueueKey(uploaded)])),
    ).toEqual([failed])
  })
})
