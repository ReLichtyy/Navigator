export type DefaultCourseScope =
  | { kind: "course"; courseId: string }
  | { kind: "doc"; docId: string }
  | null

/**
 * A real course starts at whole-course scope. Documents are an optional
 * narrowing control, except for a direct link to a specific document.
 * The uncategorized bucket has no course endpoint, so it falls back to its
 * first ready document.
 */
export function defaultCourseScope(
  courseId: string | null,
  readyDocIds: string[],
  wantedDocId: string | null,
): DefaultCourseScope {
  if (wantedDocId && readyDocIds.includes(wantedDocId)) {
    return { kind: "doc", docId: wantedDocId }
  }
  if (courseId) return { kind: "course", courseId }
  return readyDocIds[0] ? { kind: "doc", docId: readyDocIds[0] } : null
}
