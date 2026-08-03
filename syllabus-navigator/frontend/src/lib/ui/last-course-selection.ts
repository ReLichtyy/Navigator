/** Shared browser preference for the last course folder used across the app. */
export const LAST_COURSE_SELECTION_KEY = "navigator:last-course"

type ReadableStorage = Pick<Storage, "getItem">
type WritableStorage = Pick<Storage, "setItem">

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readLastCourseSelection(
  storage: ReadableStorage | null = browserStorage(),
): string | null {
  try {
    const value = storage?.getItem(LAST_COURSE_SELECTION_KEY)?.trim()
    return value || null
  } catch {
    return null
  }
}

export function writeLastCourseSelection(
  courseKey: string,
  storage: WritableStorage | null = browserStorage(),
): void {
  if (!courseKey) return
  try {
    storage?.setItem(LAST_COURSE_SELECTION_KEY, courseKey)
  } catch {
    // Storage may be blocked or full; selection still works for this visit.
  }
}

/** Deep links win, then the last valid course, then the first available folder. */
export function resolveInitialCourseSelection(
  availableKeys: string[],
  deepLinkedKey: string | null,
  storedKey: string | null,
): string | null {
  if (deepLinkedKey && availableKeys.includes(deepLinkedKey)) return deepLinkedKey
  if (storedKey && availableKeys.includes(storedKey)) return storedKey
  return availableKeys[0] ?? null
}
