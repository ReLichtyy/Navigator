export const MAX_FILES_PER_UPLOAD = 10
export const MAX_UPLOAD_FILE_SIZE = 25 * 1024 * 1024

export type FileQueueCandidate = Pick<File, "name" | "size" | "lastModified">

export function fileQueueKey(file: FileQueueCandidate): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

export function appendFilesToQueue<T extends FileQueueCandidate>(
  current: T[],
  incoming: T[],
  limit = MAX_FILES_PER_UPLOAD,
): { files: T[]; duplicates: T[]; excess: T[] } {
  const files = [...current]
  const keys = new Set(current.map(fileQueueKey))
  const duplicates: T[] = []
  const excess: T[] = []

  for (const file of incoming) {
    const key = fileQueueKey(file)
    if (keys.has(key)) {
      duplicates.push(file)
      continue
    }
    if (files.length >= limit) {
      excess.push(file)
      continue
    }
    keys.add(key)
    files.push(file)
  }

  return { files, duplicates, excess }
}

export function filesRemainingAfterUpload<T extends FileQueueCandidate>(
  files: T[],
  completedKeys: ReadonlySet<string>,
): T[] {
  return files.filter((file) => !completedKeys.has(fileQueueKey(file)))
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function getUploadFileValidationError(file: Pick<File, "name" | "size">): string | null {
  if (!/\.(pdf|docx|pptx|xlsx)$/i.test(file.name)) {
    return `${file.name}: solo PDF, Word, PowerPoint o Excel.`
  }
  if (file.size === 0) return `${file.name} está vacío.`
  if (file.size > MAX_UPLOAD_FILE_SIZE) return `${file.name} supera el límite de 25MB.`
  return null
}
