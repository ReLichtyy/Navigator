/**
 * streak.ts — pure study-streak computation (UI-13). Kept free of DB/React so
 * it is unit-testable in isolation; the repo and tests both import from here.
 */

const DAY_MS = 86_400_000

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Consecutive-day streak ending today (or yesterday) from a set of ISO dates. */
export function streakFromDates(isoDates: string[], todayIso: string): number {
  const days = new Set(isoDates)
  if (days.size === 0) return 0

  const today = new Date(`${todayIso}T00:00:00Z`).getTime()

  let cursor: number
  if (days.has(todayIso)) cursor = today
  else if (days.has(iso(today - DAY_MS))) cursor = today - DAY_MS
  else return 0

  let streak = 0
  while (days.has(iso(cursor))) {
    streak++
    cursor -= DAY_MS
  }
  return streak
}
