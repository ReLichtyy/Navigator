import { ScheduleRepository, type ScheduleEvent } from "../repositories/schedule.repo"
import { DocumentRepository } from "../repositories/document.repo"
import { ApiErrorResponse } from "../utils/auth-helpers"
import { resolveEventWeekDates } from "../rag/week-date"

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export const ScheduleService = {
  /**
   * The user's full agenda across all their courses — past events included, so
   * the calendar can browse back into earlier months of the term. Events that
   * only carry a "Semana N" label resolve to a real date when their course has
   * a term_start.
   */
  async getAgenda(userId: string): Promise<{ today: string; events: ScheduleEvent[] }> {
    const today = todayISO()
    const events = await ScheduleRepository.listAllByUser(userId)
    return { today, events: resolveEventWeekDates(events) }
  },

  /** Full schedule for one syllabus the user owns (past included). */
  async getForSyllabus(userId: string, syllabusId: string): Promise<{ events: ScheduleEvent[] }> {
    const doc = await DocumentRepository.findByIdAndUser(syllabusId, userId)
    if (!doc) throw new ApiErrorResponse("Syllabus not found", 404)
    const events = await ScheduleRepository.listBySyllabus(syllabusId)
    return { events: resolveEventWeekDates(events) }
  },
}
