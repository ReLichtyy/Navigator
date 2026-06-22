/**
 * server/services/recommendation.service.ts — dynamic weekly study plan.
 *
 * Combines the student's schedule (schedule_events) with the prerequisite graph
 * (topics + topic_dependencies) to produce actionable recommendations:
 *   - upcoming assessments (quiz/exam/assignment/project) with days-until
 *   - topics covered this week
 *   - for each assessment, "review first" = prerequisites of matching topics
 */

import { ScheduleRepository, type ScheduleEvent } from "../repositories/schedule.repo"
import { GraphRepository } from "../repositories/graph.repo"

const ASSESSMENT_TYPES = new Set(["quiz", "exam", "assignment", "project"])
const HORIZON_DAYS = 21

export interface UpcomingAssessment {
  id: string
  course_name: string
  event_type: string
  title: string
  event_date: string | null
  week_label: string | null
  weight_percent: number | null
  days_until: number | null
  review_first: string[]
}

export interface WeeklyPlan {
  today: string
  week_start: string
  week_end: string
  this_week_topics: ScheduleEvent[]
  upcoming_assessments: UpcomingAssessment[]
}

function todayISO(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** Monday-anchored week range containing `base`. */
function weekRange(base: Date): { start: string; end: string } {
  const day = base.getDay() // 0=Sun..6=Sat
  const diffToMon = (day + 6) % 7
  const start = new Date(base)
  start.setDate(base.getDate() - diffToMon)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return { start: todayISO(start), end: todayISO(end) }
}

function daysBetween(fromISO: string, toISO: string): number {
  const ms = new Date(toISO + "T00:00:00").getTime() - new Date(fromISO + "T00:00:00").getTime()
  return Math.round(ms / 86_400_000)
}

export const RecommendationService = {
  async getWeeklyPlan(userId: string): Promise<WeeklyPlan> {
    const now = new Date()
    const today = todayISO(now)
    const { start: week_start, end: week_end } = weekRange(now)

    const [events, topics] = await Promise.all([
      ScheduleRepository.listAgendaByUser(userId, today, 100),
      GraphRepository.listUserTopicsWithPrereqs(userId),
    ])

    // Topic label → prereqs, scoped per syllabus, lowercased for matching.
    const topicsBySyllabus = new Map<string, { label: string; prereqs: string[] }[]>()
    for (const t of topics) {
      const arr = topicsBySyllabus.get(t.syllabus_id) ?? []
      arr.push({ label: t.label, prereqs: t.prereqs })
      topicsBySyllabus.set(t.syllabus_id, arr)
    }

    const reviewFor = (syllabusId: string, title: string): string[] => {
      const lower = title.toLowerCase()
      const matches = (topicsBySyllabus.get(syllabusId) ?? []).filter(
        (t) => t.label && (lower.includes(t.label.toLowerCase()) || t.label.toLowerCase().includes(lower)),
      )
      const out = new Set<string>()
      for (const m of matches) for (const p of m.prereqs) out.add(p)
      return [...out].slice(0, 6)
    }

    const this_week_topics = events.filter(
      (e) =>
        (e.event_type === "class" || e.event_type === "reading") &&
        e.event_date != null &&
        e.event_date >= week_start &&
        e.event_date <= week_end,
    )

    const upcoming_assessments: UpcomingAssessment[] = events
      .filter((e) => ASSESSMENT_TYPES.has(e.event_type))
      .filter((e) => e.event_date == null || daysBetween(today, e.event_date) <= HORIZON_DAYS)
      .sort((a, b) => (a.event_date ?? "9999").localeCompare(b.event_date ?? "9999"))
      .slice(0, 8)
      .map((e) => ({
        id: e.id,
        course_name: e.course_name,
        event_type: e.event_type,
        title: e.title,
        event_date: e.event_date,
        week_label: e.week_label,
        weight_percent: e.weight_percent,
        days_until: e.event_date ? daysBetween(today, e.event_date) : null,
        review_first: reviewFor(e.syllabus_id, e.title),
      }))

    return { today, week_start, week_end, this_week_topics, upcoming_assessments }
  },
}
