"use client"

import { RefreshCw } from "lucide-react"
import type { StudySetAPI } from "@/lib/api"
import { BackButton, EmptyMode } from "./flashcards-view"

const DOTS = ["bg-accent", "bg-blue-400", "bg-purple-400", "bg-amber-400"]

export function MindView({
  courseLabel,
  mindmap,
  onBack,
}: {
  courseLabel: string
  mindmap: StudySetAPI["mindmap"]
  onBack: () => void
}) {
  if (!mindmap.center && mindmap.branches.length === 0) {
    return <EmptyMode onBack={onBack} label="No hay mapa mental para este curso." />
  }
  return (
    <div>
      <BackButton onBack={onBack} />
      <h2 className="text-xl font-bold tracking-tight">Mapa mental</h2>
      <p className="mt-1 text-sm text-muted-foreground">{courseLabel}</p>

      <div className="mt-7 flex flex-col items-stretch gap-0 md:flex-row md:items-center">
        <div className="flex h-32 w-full flex-none flex-col items-center justify-center rounded-2xl border-[1.5px] border-accent/45 bg-accent/10 p-4 text-center md:w-52">
          <span className="text-[10px] font-bold uppercase tracking-widest text-accent/80">Tema central</span>
          <span className="mt-1.5 text-base font-extrabold leading-tight text-foreground">{mindmap.center}</span>
        </div>
        <div className="relative flex flex-1 flex-col gap-3.5 pt-4 md:pl-9 md:pt-0">
          {mindmap.branches.map((b, i) => (
            <div key={i} className="flex items-center gap-3.5">
              <div className="hidden h-0.5 w-8 flex-none bg-gradient-to-r from-accent/50 to-accent/10 md:block" />
              <div className="flex-1 rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center gap-2.5">
                  <span className={`h-2.5 w-2.5 rounded-sm ${DOTS[i % DOTS.length]}`} />
                  <span className="text-sm font-bold text-foreground">{b.label}</span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {b.items.map((it, j) => (
                    <span
                      key={j}
                      className="rounded-lg border border-border bg-secondary/50 px-2.5 py-1 text-xs font-medium text-muted-foreground"
                    >
                      {it}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ResumenView({
  courseName,
  summary,
  regenerating,
  onRegenerate,
  onFlash,
  onQuiz,
  onBack,
}: {
  courseName: string
  summary: StudySetAPI["summary"]
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
            <div className="mt-1 text-xs text-muted-foreground">Generado desde el knowledge base del curso</div>
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
