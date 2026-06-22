import { ScheduleRepository, type ScheduleEvent } from "../repositories/schedule.repo"
import { DocumentRepository } from "../repositories/document.repo"
import { ApiErrorResponse } from "../utils/auth-helpers"

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export const ScheduleService = {
  /** The user's upcoming agenda across all their courses. */
  async getAgenda(userId: string): Promise<{ today: string; events: ScheduleEvent[] }> {
    const today = todayISO()
    const events = await ScheduleRepository.listAgendaByUser(userId, today)
    return { today, events }
  },

  /** Full schedule for one syllabus the user owns. */
  async getForSyllabus(userId: string, syllabusId: string): Promise<{ events: ScheduleEvent[] }> {
    const doc = await DocumentRepository.findByIdAndUser(syllabusId, userId)
    if (!doc) throw new ApiErrorResponse("Syllabus not found", 404)
    const events = await ScheduleRepository.listBySyllabus(syllabusId)
    return { events }
  },
}
