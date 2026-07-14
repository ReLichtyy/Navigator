/**
 * server/utils/today.ts — "today" in the student's calendar, not the server's.
 *
 * Vercel runs in UTC. Deriving today from `new Date()` on the server puts a
 * UTC-5 student into tomorrow from 19:00 local time: the calendar highlights
 * the wrong day, Sunday evening jumps the "Semana actual" a week ahead, and an
 * assessment due today falls out of the `event_date >= today` cutoff. So the
 * client sends its IANA zone and every date decision derives from that.
 */

/** Zone used when the client sent none (chat tools, cron) or sent garbage. */
const FALLBACK_TZ = process.env.APP_TIMEZONE || "America/Lima"

/** The zone if Intl accepts it, else null — callers fall back to APP_TIMEZONE. */
export function normalizeTimeZone(tz: string | null | undefined): string | null {
  if (!tz || tz.length > 64) return null
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz })
    return tz
  } catch {
    return null
  }
}

/** ISO yyyy-mm-dd for "now" in `tz`. `en-CA` formats dates as yyyy-mm-dd. */
export function todayISO(tz?: string | null, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeTimeZone(tz) ?? FALLBACK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}
