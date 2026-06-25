"use client"

import { RefreshCw } from "lucide-react"
import type { StudySetAPI } from "@/lib/api"
import { BackButton, EmptyMode } from "./flashcards-view"
import { MindMapCanvas, type MindCourse } from "./mind-map-canvas"

export function MindView({
  courseCode,
  courseLabel,
  mindmap,
  courses,
  activeCourseId,
  onPickCourse,
  onTopicDouble,
  regenerating = false,
  onRegenerate,
  onBack,
}: {
  courseCode: string
  courseLabel: string
  mindmap: StudySetAPI["mindmap"]
  courses: MindCourse[]
  activeCourseId: string
  onPickCourse: (id: string) => void
  onTopicDouble?: (label: string) => void
  regenerating?: boolean
  onRegenerate?: () => void
  onBack: () => void
}) {
  if (!mindmap.center && mindmap.branches.length === 0) {
    return <EmptyMode onBack={onBack} label="No hay mapa mental para este curso." />
  }
  return (
    <div className="animate-fade-up">
      <BackButton onBack={onBack} />
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-[21px] font-extrabold tracking-tight text-foreground">Mapa mental</h2>
        <span className="text-[13px] text-muted-foreground">
          {courseCode} · {courseLabel}
        </span>
      </div>

      <div className="mt-3.5">
        <MindMapCanvas
          mindmap={mindmap}
          courses={courses}
          activeCourseId={activeCourseId}
          onPickCourse={onPickCourse}
          onTopicDouble={onTopicDouble}
          courseCode={courseCode}
          courseName={courseLabel}
          loading={regenerating}
          onRegenerate={() => onRegenerate?.()}
        />
      </div>
    </div>
  )
}

export function ResumenView({
  courseName,
  summary,
  studyGuide,
  regenerating,
  onRegenerate,
  onFlash,
  onQuiz,
  onBack,
}: {
  courseName: string
  summary: StudySetAPI["summary"]
  studyGuide?: StudySetAPI["studyGuide"]
  regenerating: boolean
  onRegenerate: () => void
  onFlash: () => void
  onQuiz: () => void
  onBack: () => void
}) {
  if (!summary.intro && summary.points.length === 0) {
    return <EmptyMode onBack={onBack} label="No hay resumen para este curso." />
  }
  return (
    <div>
      <BackButton onBack={onBack} />
      <div className="flex items-center gap-2.5">
        <h1 className="text-2xl font-extrabold tracking-tight">Resumen</h1>
        <span className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-foreground">
          Auto
        </span>
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <div className="text-lg font-extrabold tracking-tight">{courseName}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Generado desde la base de conocimiento del curso
            </div>
          </div>
          <button
            onClick={onRegenerate}
            disabled={regenerating}
            className="flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-3.5 py-2 text-xs font-semibold text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? "animate-spin" : ""}`} />
            Regenerar
          </button>
        </div>
        <div className="p-6">
          {summary.intro && (
            <p className="mb-5 text-sm leading-relaxed text-foreground/90">{summary.intro}</p>
          )}
          <div className="flex flex-col gap-4">
            {summary.points.map((p, i) => (
              <div key={i} className="flex gap-3.5">
                <div className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-accent/10 font-mono text-xs font-semibold text-accent">
                  {i + 1}
                </div>
                <div>
                  <div className="text-sm font-bold text-foreground">{p.title}</div>
                  <div className="mt-1 text-sm leading-relaxed text-muted-foreground">{p.body}</div>
                </div>
              </div>
            ))}
          </div>
          {studyGuide && studyGuide.length > 0 && (
            <div className="mt-7">
              <div className="mb-1 flex items-center gap-2">
                <h3 className="text-sm font-extrabold tracking-tight text-foreground">
                  Guía de estudio
                </h3>
                <span className="text-[11px] text-muted-foreground">
                  ordenada por peso en el examen
                </span>
              </div>
              <div className="flex flex-col gap-3">
                {studyGuide.map((s, i) => (
                  <div key={i} className="rounded-xl border border-border bg-secondary/30 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-bold text-foreground">{s.topic}</span>
                      {s.weight > 0 && (
                        <span className="flex-none rounded-md bg-accent/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-accent">
                          {Math.round(s.weight)}%
                        </span>
                      )}
                    </div>
                    <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
                      {s.points.map((p, j) => (
                        <li key={j} className="text-[13px] leading-relaxed text-muted-foreground">
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={onFlash}
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-accent-foreground transition-opacity hover:opacity-90"
            >
              Estudiar con tarjetas
            </button>
            <button
              onClick={onQuiz}
              className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              Hacer un quiz
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
