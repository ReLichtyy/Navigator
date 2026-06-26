"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowRight, Loader2, Layers } from "lucide-react"
import {
  recordMastery,
  recordQuizFail,
  fetchQuizStage,
  type QuizQuestionAPI,
  type QuizStageAPI,
  type StudyDifficulty,
} from "@/lib/api"
import { BackButton, EmptyMode } from "./flashcards-view"

/** Correct answers required to clear a stage (mirrors STAGE_SIZE on the server). */
const STAGE_SIZE = 15
/** Acing a stage (≥ this hit-rate) bumps the difficulty boost for the next stage. */
const ACE_RATE = 0.85

type Scope = { kind: "doc"; docId: string } | { kind: "course"; courseId: string }

interface Props {
  title: string
  courseLabel: string
  scope: Scope
  /** When set, per-topic outcomes feed the mastery ledger. Absent for whole-course scope. */
  syllabusId?: string
  onBack: () => void
}

const GLYPHS = ["A", "B", "C", "D", "E"]

const DIFFICULTY_LABEL: Record<StudyDifficulty, string> = {
  facil: "Fácil",
  medio: "Medio",
  dificil: "Difícil",
}

export function QuizView({ title, courseLabel, scope, syllabusId, onBack }: Props) {
  // Per-stage buffer (15 to clear + spares for wrong-answer swaps) and cursor.
  const [buffer, setBuffer] = useState<QuizQuestionAPI[]>([])
  const [pos, setPos] = useState(0)
  const [stage, setStage] = useState(0)
  const [stages, setStages] = useState(3)
  const [difficulty, setDifficulty] = useState<StudyDifficulty>("facil")

  const [selected, setSelected] = useState<number | null>(null)
  const [answered, setAnswered] = useState(false)
  const [clearedInStage, setClearedInStage] = useState(0) // correct answers this stage
  const [attemptsInStage, setAttemptsInStage] = useState(0)
  const [totalCorrect, setTotalCorrect] = useState(0)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [finished, setFinished] = useState(false)

  const boostRef = useRef(0) // escalation boost carried across stages
  const servedIds = useRef<Set<string>>(new Set())
  const outcomes = useRef<{ label: string; correct: boolean }[]>([])
  // Prefetched next stage, keyed by `${stage}:${boost}` so a boost change re-fetches.
  const prefetch = useRef<{ key: string; promise: Promise<QuizStageAPI> } | null>(null)

  const excludeList = () => Array.from(servedIds.current)
  const stageKey = (s: number, b: number) => `${s}:${b}`

  const ingest = useCallback((data: QuizStageAPI) => {
    for (const x of data.questions) if (x.id) servedIds.current.add(x.id)
    setBuffer(data.questions)
    setStages(data.stages)
    setDifficulty(data.difficulty)
    setPos(0)
    setSelected(null)
    setAnswered(false)
    setClearedInStage(0)
    setAttemptsInStage(0)
  }, [])

  const fetchStage = useCallback(
    (s: number, b: number) => fetchQuizStage(scope, { stage: s, boost: b, excludeIds: excludeList() }),
    [scope],
  )

  // Initial stage.
  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchStage(0, 0)
      .then((d) => {
        if (!alive) return
        ingest(d)
        setLoading(false)
      })
      .catch((e) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : "No se pudo cargar el quiz.")
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [fetchStage, ingest])

  const flushMastery = () => {
    const batch = outcomes.current
    outcomes.current = []
    if (syllabusId && batch.length > 0) recordMastery(syllabusId, batch).catch(() => {})
  }

  const q = buffer[pos]

  const answer = (i: number) => {
    if (answered || !q) return
    setSelected(i)
    setAnswered(true)
    const correct = i === q.answer
    setAttemptsInStage((a) => a + 1)
    if (q.topic) outcomes.current.push({ label: q.topic, correct })
    if (!correct) {
      // Wrong → the question leaves the quiz and goes to Repaso.
      void recordQuizFail(scope, q).catch(() => {})
    }
    if (correct) {
      setTotalCorrect((s) => s + 1)
      const cleared = clearedInStage + 1
      setClearedInStage(cleared)
      // Warm the next stage in the background once this one is nearly done.
      if (stage < stages - 1 && cleared === STAGE_SIZE - 3) {
        const rate = cleared / (attemptsInStage + 1)
        const nextBoost = rate >= ACE_RATE ? Math.min(boostRef.current + 1, 2) : boostRef.current
        const key = stageKey(stage + 1, nextBoost)
        if (prefetch.current?.key !== key) {
          prefetch.current = { key, promise: fetchStage(stage + 1, nextBoost) }
        }
      }
    }
  }

  // Advance to the next stage (using the prefetch when it matches), or finish.
  const advanceStage = useCallback(
    async (nextBoost: number) => {
      flushMastery()
      if (stage >= stages - 1) {
        setFinished(true)
        return
      }
      const nextStage = stage + 1
      boostRef.current = nextBoost
      setLoading(true)
      try {
        const key = stageKey(nextStage, nextBoost)
        const data =
          prefetch.current?.key === key
            ? await prefetch.current.promise
            : await fetchStage(nextStage, nextBoost)
        prefetch.current = null
        setStage(nextStage)
        ingest(data)
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo cargar la siguiente etapa.")
      } finally {
        setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stage, stages, fetchStage, ingest],
  )

  // Pull more questions for the CURRENT stage when the buffer runs dry before 15
  // correct (wrong answers consume the buffer). Bank-capped → may return nothing.
  const loadMoreCurrent = useCallback(async (): Promise<boolean> => {
    setLoading(true)
    try {
      const data = await fetchStage(stage, boostRef.current)
      const fresh = data.questions.filter((x) => x.id && !buffer.some((b) => b.id === x.id))
      for (const x of fresh) if (x.id) servedIds.current.add(x.id)
      if (fresh.length === 0) return false
      setBuffer((b) => [...b, ...fresh])
      return true
    } catch {
      return false
    } finally {
      setLoading(false)
    }
  }, [fetchStage, stage, buffer])

  const next = async () => {
    setSelected(null)
    setAnswered(false)

    // Stage cleared once 15 are answered correctly.
    if (clearedInStage >= STAGE_SIZE) {
      const rate = clearedInStage / Math.max(attemptsInStage, 1)
      const nextBoost = rate >= ACE_RATE ? Math.min(boostRef.current + 1, 2) : boostRef.current
      await advanceStage(nextBoost)
      return
    }

    // Otherwise show the next buffered question; fetch more if the buffer is dry.
    if (pos + 1 < buffer.length) {
      setPos((p) => p + 1)
      return
    }
    const got = await loadMoreCurrent()
    if (got) {
      setPos((p) => p + 1)
    } else {
      // Bank exhausted before 15 correct → close the stage with what we have.
      await advanceStage(boostRef.current)
    }
  }

  if (loading && buffer.length === 0 && !error) {
    return (
      <div className="mx-auto max-w-2xl">
        <BackButton onBack={onBack} />
        <div className="flex h-56 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Generando preguntas desde tu material…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return <EmptyMode onBack={onBack} label={error} />
  }

  if (buffer.length === 0) {
    return <EmptyMode onBack={onBack} label="No hay preguntas para este curso." />
  }

  if (finished) {
    const pct = Math.round((totalCorrect / (stages * STAGE_SIZE)) * 100)
    const emoji = pct >= 80 ? "🏆" : pct >= 50 ? "💪" : "📚"
    const heading =
      pct >= 80 ? "¡Excelente dominio!" : pct >= 50 ? "Vas por buen camino" : "A repasar un poco más"
    return (
      <div className="mx-auto max-w-2xl">
        <BackButton onBack={onBack} />
        <div className="rounded-2xl border border-accent/25 bg-accent/5 p-12 text-center">
          <div className="text-5xl">{emoji}</div>
          <h2 className="mt-3 text-2xl font-bold">{heading}</h2>
          <p className="mt-2 text-accent">
            Completaste las {stages} etapas · <b>{totalCorrect}</b> aciertos ({pct}%)
          </p>
          <div className="mt-6 flex justify-center">
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

  const stagePct = Math.round((clearedInStage / STAGE_SIZE) * 100)
  const correct = selected === q.answer

  return (
    <div className="mx-auto max-w-2xl">
      <BackButton onBack={onBack} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">{title}</h2>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Layers className="h-3.5 w-3.5 text-accent" /> Etapa {stage + 1}/{stages}
            </span>
            <span className="rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[11px] font-semibold text-accent">
              {DIFFICULTY_LABEL[difficulty]}
            </span>
            <span className="text-muted-foreground/70">· {courseLabel}</span>
          </p>
        </div>
        <span className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 font-mono text-sm text-accent">
          {clearedInStage}/{STAGE_SIZE}
        </span>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full bg-accent transition-[width] duration-300"
          style={{ width: `${stagePct}%` }}
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
                  {correct ? "¡Correcto!" : "No suma — viene otra pregunta"}
                </div>
                <div className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {q.explanation}
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={next}
                disabled={loading}
                className="flex items-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-bold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    {clearedInStage >= STAGE_SIZE
                      ? stage >= stages - 1
                        ? "Ver resultados"
                        : "Siguiente etapa"
                      : "Siguiente pregunta"}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
