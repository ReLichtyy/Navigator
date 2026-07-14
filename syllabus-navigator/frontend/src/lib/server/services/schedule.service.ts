import { ScheduleRepository, type ScheduleEvent } from "../repositories/schedule.repo"
import { DocumentRepository } from "../repositories/document.repo"
import { ApiErrorResponse } from "../utils/auth-helpers"
import { todayISO } from "../utils/today"
import { resolveEventWeekDates, type Dated } from "../rag/week-date"

export const ScheduleService = {
  /**
   * The user's full agenda across all their courses — past events included, so
   * the calendar can browse back into earlier months of the term. Events that
   * only carry a "Semana N" label resolve to a real date when their course has
   * a term_start. `tz` is the caller's IANA zone: "today" must be the student's
   * day, not the server's UTC day (see utils/today).
   */
  async getAgenda(
    userId: string,
    tz?: string | null,
  ): Promise<{ today: string; events: Dated<ScheduleEvent>[] }> {
    const today = todayISO(tz)
    const events = await ScheduleRepository.listAllByUser(userId)
    return { today, events: resolveEventWeekDates(events) }
  },

  /** Full schedule for one syllabus the user owns (past included). */
  async getForSyllabus(
    userId: string,
    syllabusId: string,
  ): Promise<{ events: Dated<ScheduleEvent>[] }> {
    const doc = await DocumentRepository.findByIdAndUser(syllabusId, userId)
    if (!doc) throw new ApiErrorResponse("Syllabus not found", 404)
    const events = await ScheduleRepository.listBySyllabus(syllabusId)
    return { events: resolveEventWeekDates(events) }
  },
}
