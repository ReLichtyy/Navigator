"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, RotateCcw, Inbox, AlarmClock, Check, X } from "lucide-react"
import { fetchQuizReview, resolveQuizReview, recordMastery, type QuizQuestionAPI } from "@/lib/api"
import { BackButton } from "./flashcards-view"
import { RevealExplain, CiteChip, Conexiones, Ordenar, CompletarHueco } from "./quiz-parts"

type Scope = { kind: "doc"; docId: string } | { kind: "course"; courseId: string }

interface Props {
  courseLabel: string
  scope: Scope
  onBack: () => void
}

const GLYPHS = ["A", "B", "C", "D", "E"]

export function QuizReviewView({ courseLabel, scope, onBack }: Props) {
  const [queue, setQueue] = useState<QuizQuestionAPI[]>([])
  const [idx, setIdx] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [answered, setAnswered] = useState(false)
  const [resolved, setResolved] = useState(0)
  const [stillStuck, setStillStuck] = useState(0)
  // Whether the last self-contained exercise (conex/order/fill) was solved right.
  const [lastOk, setLastOk] = useState(false)
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
    if (batch.length > 0) recordMastery(scope, batch).catch(() => {})
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
  const pickedWrong = answered && !correct
  const pct = Math.round((idx / queue.length) * 100)
  const reviewNextLabel = idx + 1 >= queue.length ? "Ver resumen →" : "Siguiente →"

  // Self-contained exercise kinds (conex/order/fill): resolve on success, keep on
  // fail — mirroring the MC answer() bookkeeping.
  const completeAlt = (ok: boolean) => {
    if (answered) return
    setAnswered(true)
    setLastOk(ok)
    if (q.topic) outcomes.current.push({ label: q.topic, correct: ok })
    if (ok) {
      setResolved((r) => r + 1)
      void resolveQuizReview(scope, q.question).catch(() => {})
    } else {
      setStillStuck((s) => s + 1)
    }
  }

  const altBody =
    q.kind === "conex" && q.pairs && q.pairs.length > 0 ? (
      <Conexiones
        key={idx}
        question={q.question}
        pairs={q.pairs}
        rightOrder={q.rightOrder}
        cite={q.cite}
        onComplete={completeAlt}
        onNext={next}
        nextLabel={reviewNextLabel}
      />
    ) : q.kind === "order" && q.steps && q.steps.length > 0 ? (
      <Ordenar
        key={idx}
        question={q.question}
        steps={q.steps}
        whyYes={q.whyYes}
        cite={q.cite}
        onComplete={completeAlt}
        onNext={next}
        nextLabel={reviewNextLabel}
      />
    ) : q.kind === "fill" && q.fillText && q.fillAnswers && q.fillAnswers.length > 0 ? (
      <CompletarHueco
        key={idx}
        question={q.question}
        fillText={q.fillText}
        fillAnswers={q.fillAnswers}
        whyYes={q.whyYes}
        cite={q.cite}
        onComplete={completeAlt}
        onNext={next}
        nextLabel={reviewNextLabel}
      />
    ) : null

  return (
    <div className="mx-auto max-w-2xl">
      <BackButton onBack={onBack} />

      {/* Repaso badges (AreaEstudio.dc 4c) */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/[0.08] px-3 py-1 text-[10.5px] font-semibold text-amber-500">
          <AlarmClock className="h-3 w-3" /> De tu lista de fallos · {courseLabel}
        </span>
        <span className="rounded-full border border-border bg-secondary/40 px-3 py-1 font-mono text-[10px] text-muted-foreground">
          reintento
        </span>
        <span className="ml-auto rounded-lg border border-accent/30 bg-accent/10 px-3 py-1 font-mono text-xs text-accent">
          {resolved} dominadas · {idx + 1}/{queue.length}
        </span>
      </div>

      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full bg-accent transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      {altBody ? (
        <div className="rounded-2xl border border-border bg-card p-6">
          {answered && (
            <div
              className={`mb-4 rounded-xl border p-3 text-sm font-bold ${
                lastOk
                  ? "border-accent/25 bg-accent/5 text-accent"
                  : "border-amber-500/25 bg-amber-500/5 text-amber-500"
              }`}
            >
              {lastOk ? "¡Dominada! Sale del repaso ✦" : "Sigue en repaso — inténtala de nuevo"}
            </div>
          )}
          {altBody}
        </div>
      ) : (
        <>
        <div className="rounded-2xl border border-border bg-card p-6">
        <div className="text-lg font-bold leading-snug text-foreground">{q.question}</div>
        <div className="mt-4 flex flex-col gap-2.5">
          {q.options.map((opt, i) => {
            const isCorrect = i === q.answer
            const isPicked = i === selected
            let cls = "border-border bg-card hover:border-accent/40"
            let markCls = "border-border/60 text-muted-foreground"
            let textCls = "text-foreground"
            let tag: string | null = null
            if (answered) {
              if (isCorrect) {
                cls = "border-accent/50 bg-accent/10"
                markCls = "border-none bg-accent text-accent-foreground"
                textCls = "font-bold text-foreground"
              } else if (isPicked) {
                cls = "border-red-500/50 bg-red-500/[0.07]"
                markCls = "border-none bg-red-500 text-white"
                textCls = "font-semibold text-red-400"
              } else {
                cls = "border-border opacity-45"
                textCls = "text-muted-foreground"
              }
            } else if (isPicked) {
              cls = "border-accent bg-accent/10"
              markCls = "border-accent text-accent"
              tag = "seleccionada"
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
                  className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-bold ${markCls}`}
                >
                  {answered && isCorrect ? (
                    <Check className="h-3 w-3" strokeWidth={3.4} />
                  ) : answered && isPicked ? (
                    <X className="h-3 w-3" strokeWidth={3.4} />
                  ) : (
                    GLYPHS[i]
                  )}
                </span>
                <span className={`flex-1 text-sm leading-snug ${textCls}`}>{opt}</span>
                {tag && (
                  <span className="ml-auto shrink-0 text-[11px] font-semibold text-accent">{tag}</span>
                )}
              </button>
            )
          })}
        </div>

        {answered && (
          <>
            <div
              className={`mt-4 rounded-xl border p-3 text-sm font-bold ${
                correct
                  ? "border-accent/25 bg-accent/5 text-accent"
                  : "border-amber-500/25 bg-amber-500/5 text-amber-500"
              }`}
            >
              {correct ? "¡Dominada! Sale del repaso ✦" : "Sigue en repaso — inténtala de nuevo"}
            </div>
            <RevealExplain
              whyYes={q.explanation ? [q.explanation] : []}
              whyNo={[]}
              pickedWrong={pickedWrong}
            />
          </>
        )}
      </div>

      {answered && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <CiteChip cite={q.cite} topic={q.topic} />
          <button
            onClick={next}
            className="flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-bold text-accent-foreground transition-opacity hover:opacity-90"
          >
            {reviewNextLabel}
          </button>
        </div>
      )}
        </>
      )}
    </div>
  )
}
