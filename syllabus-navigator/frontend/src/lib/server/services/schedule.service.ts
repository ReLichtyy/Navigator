import { ScheduleRepository, type ScheduleEvent } from "../repositories/schedule.repo"
import { DocumentRepository } from "../repositories/document.repo"
import { ApiErrorResponse } from "../utils/auth-helpers"
import { resolveEventWeekDates, isoAddDays } from "../rag/week-date"

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export const ScheduleService = {
  /** The user's upcoming agenda across all their courses. */
  async getAgenda(userId: string): Promise<{ today: string; events: ScheduleEvent[] }> {
    const today = todayISO()
    const events = await ScheduleRepository.listAgendaByUser(userId, today)
    // "Semana N" events resolve to real dates when the course has a
    // term_start. A resolved date is the Monday of that week, so keep it until
    // its week fully passes (cutoff = today - 6); weeks already behind us drop
    // out, mirroring the repo's own >= today cutoff for DATED events.
    const datedInRepo = new Set(events.filter((e) => e.event_date != null).map((e) => e.id))
    const weekCutoff = isoAddDays(today, -6)
    const resolved = resolveEventWeekDates(events).filter(
      (e) => e.event_date === null || datedInRepo.has(e.id) || e.event_date >= weekCutoff,
    )
    return { today, events: resolved }
  },

  /** Full schedule for one syllabus the user owns (past included). */
  async getForSyllabus(userId: string, syllabusId: string): Promise<{ events: ScheduleEvent[] }> {
    const doc = await DocumentRepository.findByIdAndUser(syllabusId, userId)
    if (!doc) throw new ApiErrorResponse("Syllabus not found", 404)
    const events = await ScheduleRepository.listBySyllabus(syllabusId)
    return { events: resolveEventWeekDates(events) }
  },
}
