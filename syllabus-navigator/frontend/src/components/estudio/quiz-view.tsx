"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowRight, Loader2, Layers } from "lucide-react"
import {
  recordMastery,
  recordQuizFail,
  fetchQuizStage,
  fetchQuizReview,
  markQuizSeen,
  type QuizQuestionAPI,
  type QuizStageAPI,
  type StudyDifficulty,
} from "@/lib/api"
import { BackButton, EmptyMode } from "./flashcards-view"

/** Correct answers required to clear a stage (mirrors STAGE_SIZE on the server). */
const STAGE_SIZE = 15
/** Acing a stage (≥ this hit-rate) bumps the difficulty boost for the next stage. */
const ACE_RATE = 0.85
/** After this many answered in a stage, refill the buffer in the BACKGROUND (no spinner). */
const GEN_AHEAD_AFTER = 8
/** From this question on, ramp difficulty when the student is acing (few fails). */
const RAMP_AT = STAGE_SIZE - 3 // 12
/** Keep at least this many unseen questions ready so advancing never blocks on generation. */
const BUFFER_AHEAD = 3

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

/**
 * Visual "heat" for the difficulty indicator. Difícil escalates by boost: a base
 * difícil reads elegant orange, and a boosted (very hard) difícil turns red — both
 * are still the difícil stage, the colour just signals how demanding it has become.
 */
type Heat = "base" | "warn" | "hot"
function heatFor(difficulty: StudyDifficulty, boost: number): Heat {
  if (difficulty !== "dificil") return "base"
  return boost >= 2 ? "hot" : "warn"
}
const HEAT_CHIP: Record<Heat, string> = {
  base: "border-accent/30 bg-accent/10 text-accent",
  warn: "border-orange-500/40 bg-orange-500/10 text-orange-400",
  hot: "border-red-500/50 bg-red-500/10 text-red-400",
}
const HEAT_BAR: Record<Heat, string> = {
  base: "bg-accent",
  warn: "bg-orange-500",
  hot: "bg-red-500",
}

export function QuizView({ title, courseLabel, scope, syllabusId, onBack }: Props) {
  // Per-stage buffer (15 to clear + spares for wrong-answer swaps) and cursor.
  const [buffer, setBuffer] = useState<QuizQuestionAPI[]>([])
  const [pos, setPos] = useState(0)
  const [stage, setStage] = useState(0)
  const [stages, setStages] = useState(3)
  const [difficulty, setDifficulty] = useState<StudyDifficulty>("medio")
  const [boost, setBoost] = useState(0) // mirrors boostRef for rendering (heat colour)

  const [selected, setSelected] = useState<number | null>(null)
  const [answered, setAnswered] = useState(false)
  const [clearedInStage, setClearedInStage] = useState(0) // correct answers this stage
  const [attemptsInStage, setAttemptsInStage] = useState(0)
  const [totalCorrect, setTotalCorrect] = useState(0)
  const [totalAttempts, setTotalAttempts] = useState(0) // all answered across stages (final accuracy)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [finished, setFinished] = useState(false)
  const [stageDone, setStageDone] = useState(false) // showing a stage's results screen
  const [reviewOpen, setReviewOpen] = useState<number | null>(null) // Repaso count for the empty state

  const boostRef = useRef(0) // escalation boost carried across stages
  const servedIds = useRef<Set<string>>(new Set())
  const outcomes = useRef<{ label: string; correct: boolean }[]>([])
  const failedTopics = useRef<Map<string, number>>(new Map()) // wrong-answer topics this stage
  const answeredIds = useRef<string[]>([]) // bank ids answered → marked "seen" (no repeats next session)
  // Prefetched next stage, keyed by `${stage}:${boost}` so a boost change re-fetches.
  const prefetch = useRef<{ key: string; promise: Promise<QuizStageAPI> } | null>(null)
  const topupPromise = useRef<Promise<number> | null>(null) // shared in-flight top-up (dedupes bg + sync)
  const bankDryRef = useRef(false) // current difficulty exhausted → stop topping up

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
    bankDryRef.current = false // fresh stage → the bank may yield more again
    failedTopics.current = new Map() // per-stage feedback tally
  }, [])

  const fetchStage = useCallback(
    (s: number, b: number) =>
      fetchQuizStage(scope, { stage: s, boost: b, excludeIds: excludeList() }),
    [scope],
  )

  // Pull more questions for the CURRENT stage, returning how many fresh ones were
  // added. A single shared in-flight promise means a background trigger and the
  // dry-buffer fallback never double-fetch — otherwise the second call would see
  // every id already served and wrongly mark the bank dry, killing future top-ups.
  const pullMore = useCallback((): Promise<number> => {
    if (bankDryRef.current) return Promise.resolve(0)
    if (topupPromise.current) return topupPromise.current
    const p = (async () => {
      try {
        const data = await fetchStage(stage, boostRef.current)
        const fresh = data.questions.filter((x) => x.id && !servedIds.current.has(x.id))
        for (const x of fresh) if (x.id) servedIds.current.add(x.id)
        if (fresh.length === 0) {
          bankDryRef.current = true
          return 0
        }
        setBuffer((b) => [...b, ...fresh])
        setDifficulty(data.difficulty) // reflect a mid-stage ramp in the chip
        return fresh.length
      } catch {
        return 0 // a later advance retries; the dry-buffer fallback still covers us
      } finally {
        topupPromise.current = null
      }
    })()
    topupPromise.current = p
    return p
  }, [fetchStage, stage])

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

  // Persist the bank ids answered so far as "seen" → never served again in a later
  // session. Cleared after flushing so the unmount handler can't double-send.
  const flushSeen = () => {
    const ids = answeredIds.current
    if (ids.length === 0) return
    answeredIds.current = []
    markQuizSeen(scope, ids).catch(() => {})
  }

  // End the current stage: flush mastery + seen items, then show this stage's
  // results screen — or the final results when it was the last stage.
  const endStage = () => {
    flushMastery()
    flushSeen()
    if (stage >= stages - 1) setFinished(true)
    else setStageDone(true)
  }

  // Accidental exit (unmount) or scope switch → still mark what was answered as
  // seen, so re-entering doesn't repeat those questions.
  useEffect(() => {
    return () => {
      const ids = answeredIds.current
      if (ids.length > 0) {
        answeredIds.current = []
        markQuizSeen(scope, ids).catch(() => {})
      }
    }
  }, [scope])

  // When the quiz comes up empty, find out whether there are Repaso items so the
  // empty state can point the user there instead of looking broken.
  useEffect(() => {
    if (!loading && buffer.length === 0 && !error) {
      fetchQuizReview(scope)
        .then((d) => setReviewOpen(d.questions.length))
        .catch(() => setReviewOpen(0))
    }
  }, [loading, buffer.length, error, scope])

  const q = buffer[pos]

  const answer = (i: number) => {
    if (answered || !q) return
    setSelected(i)
    setAnswered(true)
    const correct = i === q.answer
    const attempts = attemptsInStage + 1
    setAttemptsInStage(attempts)
    setTotalAttempts((s) => s + 1)
    if (q.id) answeredIds.current.push(q.id) // mark as seen → no repeat next session
    if (q.topic) outcomes.current.push({ label: q.topic, correct })
    if (!correct) {
      // Wrong → the question leaves the quiz and goes to Repaso. Tally its topic
      // so the stage feedback can name what to reinforce.
      if (q.topic) failedTopics.current.set(q.topic, (failedTopics.current.get(q.topic) ?? 0) + 1)
      void recordQuizFail(scope, q).catch(() => {})
    }
    const cleared = correct ? clearedInStage + 1 : clearedInStage
    if (correct) {
      setTotalCorrect((s) => s + 1)
      setClearedInStage(cleared)
    }

    const acing = cleared / attempts >= ACE_RATE // few fails so far

    // From Q12, ramp difficulty when the student is acing: bump the boost so every
    // question generated from here on (background top-ups + the next stage) is harder.
    if (attempts >= RAMP_AT && acing && boostRef.current < 2) {
      boostRef.current += 1
      setBoost(boostRef.current)
      bankDryRef.current = false // a new difficulty may have fresh items to pull
    }

    // Warm the NEXT stage in the background once this one is nearly cleared.
    if (correct && stage < stages - 1 && cleared === STAGE_SIZE - 3) {
      const key = stageKey(stage + 1, boostRef.current)
      if (prefetch.current?.key !== key) {
        prefetch.current = { key, promise: fetchStage(stage + 1, boostRef.current) }
      }
    }

    // After Q8, keep the buffer topped up in the BACKGROUND so the next advance
    // never blocks on generation (one answered → one more on the way).
    if (attempts >= GEN_AHEAD_AFTER && buffer.length - (pos + 1) <= BUFFER_AHEAD) {
      void pullMore()
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
      setBoost(nextBoost)
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

  // Dry-buffer fallback (shows a spinner): reuse the shared top-up so it can't race
  // a background pull. Bank-capped → may return nothing.
  const loadMoreCurrent = useCallback(async (): Promise<boolean> => {
    setLoading(true)
    try {
      return (await pullMore()) > 0
    } finally {
      setLoading(false)
    }
  }, [pullMore])

  // Move from the stage-results screen into the next stage (difficulty already
  // ramped via boostRef). Keeps the results visible until the next stage is ready
  // (no flash of the old buffer).
  const continueStage = async () => {
    await advanceStage(boostRef.current)
    setStageDone(false)
  }

  const next = async () => {
    setSelected(null)
    setAnswered(false)

    // Stage cleared once 15 are answered correctly → show this stage's results.
    if (clearedInStage >= STAGE_SIZE) {
      endStage()
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
      endStage()
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
    const label =
      reviewOpen && reviewOpen > 0
        ? "Ya respondiste las preguntas disponibles. Ve a Repaso para dominar las que fallaste."
        : "No hay preguntas nuevas: completaste el banco disponible o el material aún no está listo."
    return <EmptyMode onBack={onBack} label={label} />
  }

  if (finished) {
    // True accuracy over questions actually answered (a stage can close early when
    // the bank runs dry, so a fixed stages×15 denominator would understate it).
    const pct = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0
    const emoji = pct >= 80 ? "🏆" : pct >= 50 ? "💪" : "📚"
    const heading =
      pct >= 80
        ? "¡Excelente dominio!"
        : pct >= 50
          ? "Vas por buen camino"
          : "A repasar un poco más"
    return (
      <div className="mx-auto max-w-2xl">
        <BackButton onBack={onBack} />
        <div className="rounded-2xl border border-accent/25 bg-accent/5 p-12 text-center">
          <div className="text-5xl">{emoji}</div>
          <h2 className="mt-3 text-2xl font-bold">{heading}</h2>
          <p className="mt-2 text-accent">
            Completaste las {stages} etapas · <b>{totalCorrect}</b> aciertos · {pct}% de precisión
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

  // Between-stage results + feedback: shown when a stage closes (15 cleared, or the
  // bank ran dry) and there's another stage to go.
  if (stageDone) {
    const failed = Math.max(attemptsInStage - clearedInStage, 0)
    const acc = attemptsInStage > 0 ? clearedInStage / attemptsInStage : 0
    const accPct = Math.round(acc * 100)
    const tier =
      acc >= 0.9
        ? { emoji: "🎯", head: "Dominio sólido" }
        : acc >= 0.7
          ? { emoji: "💪", head: "Buen ritmo" }
          : { emoji: "📚", head: "A reforzar" }
    // Advice keyed on WHAT was missed: name the most-failed topics so the tip is
    // actionable, not a generic accuracy message. Falls back when topics are absent.
    const missed = [...failedTopics.current.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)
    const topMissed = missed.slice(0, 3)
    const advice =
      failed === 0
        ? "Etapa perfecta, sin fallos. Vas listo para subir el nivel."
        : topMissed.length > 0
          ? `Consejo: refuerza ${topMissed.join(", ")} — esas preguntas pasaron a tu Repaso. Domínalas antes de avanzar.`
          : "Consejo: vuelve a tu Repaso y reintenta las preguntas falladas hasta dominarlas."
    const heat = heatFor(difficulty, boost)
    // Each stage escalates; there's still room to climb unless already at the top
    // (difícil with full boost).
    const harderNext = difficulty !== "dificil" || boost < 2
    return (
      <div className="mx-auto max-w-2xl">
        <BackButton onBack={onBack} />
        <div className="rounded-2xl border border-accent/25 bg-accent/5 p-10 text-center">
          <div className="text-5xl">{tier.emoji}</div>
          <p className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground">
            <Layers className="h-4 w-4 text-accent" /> Etapa {stage + 1}/{stages} completada
          </p>
          <h2 className="mt-1 text-2xl font-bold">{tier.head}</h2>
          <div className="mt-5 flex justify-center gap-3">
            <div className="rounded-xl border border-accent/25 bg-card px-5 py-3">
              <div className="text-2xl font-bold text-accent">{clearedInStage}</div>
              <div className="text-xs text-muted-foreground">aciertos</div>
            </div>
            <div className="rounded-xl border border-border bg-card px-5 py-3">
              <div className="text-2xl font-bold text-red-400">{failed}</div>
              <div className="text-xs text-muted-foreground">a Repaso</div>
            </div>
            <div className="rounded-xl border border-border bg-card px-5 py-3">
              <div className="text-2xl font-bold text-foreground">{accPct}%</div>
              <div className="text-xs text-muted-foreground">precisión</div>
            </div>
          </div>
          <p className="mt-5 text-sm leading-relaxed text-muted-foreground">{advice}</p>
          {harderNext && (
            <p className="mt-3 inline-flex items-center gap-2 text-sm">
              <span
                className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${HEAT_CHIP[heat === "base" ? "warn" : heat]}`}
              >
                Sube la dificultad
              </span>
              <span className="text-muted-foreground">la siguiente etapa será más exigente.</span>
            </p>
          )}
          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={continueStage}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Siguiente etapa <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
            <button
              onClick={onBack}
              className="rounded-xl border border-border px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              Salir
            </button>
          </div>
        </div>
      </div>
    )
  }

  const stagePct = Math.round((clearedInStage / STAGE_SIZE) * 100)
  const heat = heatFor(difficulty, boost)
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
            <span
              className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold transition-colors ${HEAT_CHIP[heat]}`}
            >
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
          className={`h-full transition-[width,background-color] duration-300 ${HEAT_BAR[heat]}`}
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
