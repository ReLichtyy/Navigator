"use client"

import { useRef, useState } from "react"
import { ArrowRight } from "lucide-react"
import { recordMastery, type QuizQuestionAPI } from "@/lib/api"
import { BackButton, EmptyMode } from "./flashcards-view"

interface Props {
  title: string
  courseLabel: string
  questions: QuizQuestionAPI[]
  syllabusId: string
  onBack: () => void
}

const GLYPHS = ["A", "B", "C", "D", "E"]

export function QuizView({ title, courseLabel, questions, syllabusId, onBack }: Props) {
  const [qi, setQi] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [answered, setAnswered] = useState(false)
  const [score, setScore] = useState(0)
  const [finished, setFinished] = useState(false)
  // Per-topic outcomes collected this run; flushed to the mastery ledger on finish.
  const outcomes = useRef<{ label: string; correct: boolean }[]>([])

  if (questions.length === 0) {
    return <EmptyMode onBack={onBack} label="No hay preguntas para este curso." />
  }

  const total = questions.length
  const q = questions[qi]

  // Persist topic confidence from this run (only questions tagged with a topic).
  const flushMastery = () => {
    const batch = outcomes.current
    outcomes.current = []
    if (batch.length > 0) recordMastery(syllabusId, batch).catch(() => {})
  }

  const answer = (i: number) => {
    if (answered) return
    setSelected(i)
    setAnswered(true)
    const correct = i === q.answer
    if (correct) setScore((s) => s + 1)
    if (q.topic) outcomes.current.push({ label: q.topic, correct })
  }

  const next = () => {
    if (qi + 1 >= total) {
      flushMastery()
      setFinished(true)
      return
    }
    setQi((v) => v + 1)
    setSelected(null)
    setAnswered(false)
  }

  const restart = () => {
    outcomes.current = []
    setQi(0)
    setSelected(null)
    setAnswered(false)
    setScore(0)
    setFinished(false)
  }

  if (finished) {
    const pct = Math.round((score / total) * 100)
    const emoji = pct >= 80 ? "🏆" : pct >= 50 ? "💪" : "📚"
    const heading = pct >= 80 ? "¡Excelente dominio!" : pct >= 50 ? "Vas por buen camino" : "A repasar un poco más"
    return (
      <div className="mx-auto max-w-2xl">
        <BackButton onBack={onBack} />
        <div className="rounded-2xl border border-accent/25 bg-accent/5 p-12 text-center">
          <div className="text-5xl">{emoji}</div>
          <h2 className="mt-3 text-2xl font-bold">{heading}</h2>
          <p className="mt-2 text-accent">
            Obtuviste <b>{score}</b> de <b>{total}</b> ({pct}%)
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={restart}
              className="rounded-xl border border-accent/30 bg-accent/10 px-5 py-2.5 text-sm font-bold text-accent transition-colors hover:bg-accent/20"
            >
              Reintentar
            </button>
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

  const pct = Math.round(((qi + (answered ? 1 : 0)) / total) * 100)
  const correct = selected === q.answer

  return (
    <div className="mx-auto max-w-2xl">
      <BackButton onBack={onBack} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {courseLabel} · Pregunta {qi + 1} de {total}
          </p>
        </div>
        <span className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 font-mono text-sm text-accent">
          Aciertos {score}
        </span>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
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
                  className={`flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-md border font-mono text-xs font-semibold ${markCls}`}
                  style={{ width: 26, height: 26 }}
                >
                  {glyph}
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
                  {correct ? "¡Correcto!" : "Para recordar"}
                </div>
                <div className="mt-1 text-sm leading-relaxed text-muted-foreground">{q.explanation}</div>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={next}
                className="flex items-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-bold text-accent-foreground transition-opacity hover:opacity-90"
              >
                {qi + 1 >= total ? "Ver resultados" : "Siguiente pregunta"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
