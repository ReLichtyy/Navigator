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

/** Persist first so an immediate route change cannot lose the user's choice. */
export function selectAndPersistCourse(
  courseKey: string,
  select: (courseKey: string) => void,
  storage: WritableStorage | null = browserStorage(),
): void {
  writeLastCourseSelection(courseKey, storage)
  select(courseKey)
}

/** Keep the address aligned so a stale deep link cannot win on the next reload. */
export function courseSelectionHref(
  pathname: string,
  currentSearch: string,
  courseKey: string,
): string {
  const params = new URLSearchParams(currentSearch)
  if (courseKey === "__none__") params.delete("course")
  else params.set("course", courseKey)
  const search = params.toString()
  return search ? `${pathname}?${search}` : pathname
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
