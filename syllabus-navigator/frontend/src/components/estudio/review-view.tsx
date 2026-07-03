"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowRight, Loader2, RotateCcw, Inbox } from "lucide-react"
import { fetchQuizReview, resolveQuizReview, recordMastery, type QuizQuestionAPI } from "@/lib/api"
import { BackButton } from "./flashcards-view"

type Scope = { kind: "doc"; docId: string } | { kind: "course"; courseId: string }

interface Props {
  courseLabel: string
  scope: Scope
  /** When set, correct re-answers feed the mastery ledger (doc scope only). */
  syllabusId?: string
  onBack: () => void
}

const GLYPHS = ["A", "B", "C", "D", "E"]

export function QuizReviewView({ courseLabel, scope, syllabusId, onBack }: Props) {
  const [queue, setQueue] = useState<QuizQuestionAPI[]>([])
  const [idx, setIdx] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [answered, setAnswered] = useState(false)
  const [resolved, setResolved] = useState(0)
  const [stillStuck, setStillStuck] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const outcomes = useRef<{ label: string; correct: boolean }[]>([])

  const load = useCallback(() => {
    setLoading(true)
    fetchQuizReview(scope)
      .then((d) => {
        setQueue(d.questions)
        setIdx(0)
        setSelected(null)
        setAnswered(false)
        setResolved(0)
        setStillStuck(0)
        outcomes.current = []
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el repaso."))
      .finally(() => setLoading(false))
  }, [scope])

  useEffect(() => load(), [load])

  const flushMastery = () => {
    const batch = outcomes.current
    outcomes.current = []
    if (syllabusId && batch.length > 0) recordMastery(syllabusId, batch).catch(() => {})
  }

  const q = queue[idx]

  const answer = (i: number) => {
    if (answered || !q) return
    setSelected(i)
    setAnswered(true)
    const correct = i === q.answer
    if (q.topic) outcomes.current.push({ label: q.topic, correct })
    if (correct) {
      setResolved((r) => r + 1)
      // Answered right → drop it from the Repaso queue.
      void resolveQuizReview(scope, q.question).catch(() => {})
    } else {
      setStillStuck((s) => s + 1)
    }
  }

  const next = () => {
    setSelected(null)
    setAnswered(false)
    if (idx + 1 >= queue.length) {
      flushMastery()
      setIdx(queue.length) // → summary
      return
    }
    setIdx((v) => v + 1)
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl">
        <BackButton onBack={onBack} />
        <div className="flex h-56 items-center justify-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <BackButton onBack={onBack} />
        <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {error}
        </p>
      </div>
    )
  }

  // Empty queue → nothing failed yet.
  if (queue.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <BackButton onBack={onBack} />
        <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-border bg-card text-center text-muted-foreground">
          <Inbox className="mb-3 h-10 w-10 opacity-25" />
          <p className="mb-1 text-sm font-medium">No tienes nada que repasar.</p>
          <p className="text-xs">
            Las preguntas que falles en el Quiz aparecerán aquí para que las domines.
          </p>
        </div>
      </div>
    )
  }

  // Walked the whole queue → summary.
  if (idx >= queue.length) {
    return (
      <div className="mx-auto max-w-2xl">
        <BackButton onBack={onBack} />
        <div className="rounded-2xl border border-accent/25 bg-accent/5 p-12 text-center">
          <div className="text-5xl">{stillStuck === 0 ? "🎯" : "💪"}</div>
          <h2 className="mt-3 text-2xl font-bold">
            {stillStuck === 0 ? "¡Repaso limpio!" : "Buen avance"}
          </h2>
          <p className="mt-2 text-accent">
            Dominaste <b>{resolved}</b> · quedan <b>{stillStuck}</b> por repasar
          </p>
          <div className="mt-6 flex justify-center gap-3">
            {stillStuck > 0 && (
              <button
                onClick={load}
                className="flex items-center gap-1.5 rounded-xl border border-accent/30 bg-accent/10 px-5 py-2.5 text-sm font-bold text-accent transition-colors hover:bg-accent/20"
              >
                <RotateCcw className="h-4 w-4" /> Repasar lo que queda
              </button>
            )}
            <button
              onClick={onBack}
              className="rounded-xl border border-border px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              Volver al estudio
            </button>
          </div>
        </div>
      </div>
    )
  }

  const correct = selected === q.answer
  const pct = Math.round((idx / queue.length) * 100)

  return (
    <div className="mx-auto max-w-2xl">
      <BackButton onBack={onBack} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Repaso · preguntas falladas</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {courseLabel} · {idx + 1} de {queue.length}
          </p>
        </div>
        <span className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 font-mono text-sm text-accent">
          {resolved} dominadas
        </span>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full bg-accent transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card p-6">
        <div className="text-lg font-bold leading-snug text-foreground">{q.question}</div>
        <div className="mt-5 flex flex-col gap-3">
          {q.options.map((opt, i) => {
            let cls = "border-border bg-card hover:border-accent/30"
            let glyph = GLYPHS[i]
            let markCls = "border-border text-muted-foreground"
            if (answered) {
              if (i === q.answer) {
                cls = "border-accent/50 bg-accent/10 text-accent-foreground"
                glyph = "✓"
                markCls = "border-accent/60 text-accent"
              } else if (i === selected) {
                cls = "border-red-500/50 bg-red-500/5 text-red-400"
                glyph = "✕"
                markCls = "border-red-500/50 text-red-400"
              } else {
                cls = "border-border text-muted-foreground"
              }
            } else if (i === selected) {
              cls = "border-accent/40 bg-card"
            }
            return (
              <button
                key={i}
                onClick={() => answer(i)}
                disabled={answered}
                className={`flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition-colors ${cls} ${
                  answered ? "cursor-default" : "cursor-pointer"
                }`}
              >
                <span
                  className="flex shrink-0 items-center justify-center rounded-md border font-mono text-xs font-semibold"
                  style={{ width: 26, height: 26 }}
                >
                  <span className={markCls}>{glyph}</span>
                </span>
                <span className="flex-1 text-sm font-medium leading-snug">{opt}</span>
              </button>
            )
          })}
        </div>

        {answered && (
          <>
            <div
              className={`mt-4 flex items-start gap-3 rounded-xl border p-4 ${
                correct ? "border-accent/25 bg-accent/5" : "border-border bg-secondary/50"
              }`}
            >
              <span className="text-base">{correct ? "✅" : "💡"}</span>
              <div>
                <div className={`text-sm font-bold ${correct ? "text-accent" : "text-foreground"}`}>
                  {correct ? "¡Dominada! Sale del repaso" : "Sigue en repaso — inténtala de nuevo"}
                </div>
                <div className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {q.explanation}
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={next}
                className="flex items-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-bold text-accent-foreground transition-opacity hover:opacity-90"
              >
                {idx + 1 >= queue.length ? "Ver resumen" : "Siguiente"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
