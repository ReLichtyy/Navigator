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
import { todayISO } from "../utils/today"
import {
  resolveEventWeekDates,
  isoAddDays,
  mondayOf,
  type Dated,
  type DatePrecision,
} from "../rag/week-date"

const ASSESSMENT_TYPES = new Set(["quiz", "exam", "assignment", "project"])
const HORIZON_DAYS = 21

export interface UpcomingAssessment {
  id: string
  syllabus_id: string
  course_id: string | null
  course_name: string
  /** The course's persisted color — the UI paints the assessment with it. */
  course_color: string | null
  event_type: string
  title: string
  event_date: string | null
  week_label: string | null
  /** `week` → event_date is the Monday of "Semana N", not the real day. */
  date_precision: DatePrecision
  weight_percent: number | null
  days_until: number | null
  review_first: string[]
}

export interface WeeklyPlan {
  today: string
  week_start: string
  week_end: string
  this_week_topics: Dated<ScheduleEvent>[]
  upcoming_assessments: UpcomingAssessment[]
}

function daysBetween(fromISO: string, toISO: string): number {
  const ms = new Date(toISO + "T00:00:00").getTime() - new Date(fromISO + "T00:00:00").getTime()
  return Math.round(ms / 86_400_000)
}

export const RecommendationService = {
  /** `tz` = the caller's IANA zone; "today" is the student's day (utils/today). */
  async getWeeklyPlan(userId: string, tz?: string | null): Promise<WeeklyPlan> {
    const today = todayISO(tz)
    // Monday-anchored week around `today`, in plain ISO math — no second clock
    // to disagree with the one that produced `today`.
    const week_start = mondayOf(today) ?? today
    const week_end = isoAddDays(week_start, 6)

    const [rawEvents, topics] = await Promise.all([
      ScheduleRepository.listAgendaByUser(userId, today, 100),
      GraphRepository.listUserTopicsWithPrereqs(userId),
    ])
    // Resolve "Semana N" → real dates (course term_start). A resolved date is
    // the MONDAY of that week, so it stays relevant until its week fully
    // passes (cutoff = today - 6 days); older ones must not surface as
    // "upcoming". Events dated in the repo pass through (the repo already
    // applied its own >= today cutoff).
    const datedInRepo = new Set(rawEvents.filter((e) => e.event_date != null).map((e) => e.id))
    const weekCutoff = isoAddDays(today, -6)
    const events = resolveEventWeekDates(rawEvents).filter(
      (e) => e.event_date === null || datedInRepo.has(e.id) || e.event_date >= weekCutoff,
    )

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
        (t) =>
          t.label &&
          (lower.includes(t.label.toLowerCase()) || t.label.toLowerCase().includes(lower)),
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
        syllabus_id: e.syllabus_id,
        course_id: e.course_id,
        course_name: e.course_name,
        course_color: e.course_color,
        event_type: e.event_type,
        title: e.title,
        event_date: e.event_date,
        week_label: e.week_label,
        date_precision: e.date_precision,
        weight_percent: e.weight_percent,
        // Clamped ≥ 0: a week-resolved date (Monday) can sit earlier in the
        // current week without the assessment being "past". Only `exact` dates
        // may be rendered as a day count — see date_precision.
        days_until: e.event_date ? Math.max(0, daysBetween(today, e.event_date)) : null,
        review_first: reviewFor(e.syllabus_id, e.title),
      }))

    return { today, week_start, week_end, this_week_topics, upcoming_assessments }
  },
}
