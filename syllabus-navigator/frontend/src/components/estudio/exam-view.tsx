"use client"

/**
 * exam-view.tsx — the Examen mode: a single-page, sectioned, timed exam.
 *
 * Unlike the quiz (one-by-one, immediate feedback), this renders the WHOLE
 * paper at once — Sección I opción múltiple, II respuesta corta, III
 * desarrollo — with a 20-minute countdown and a single "Entregar": no
 * per-question feedback until the LLM grader returns the per-question scores.
 *
 * Flow: config (template auto-inferred from the course's subject, overridable)
 * → running (countdown from a persisted deadline; auto-submit at 0) → grading
 * → results. Progress is snapshotted to localStorage so a refresh resumes with
 * the SAME deadline; an expired snapshot offers to submit the saved answers.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { AlarmClock, ArrowRight, Loader2, RotateCcw, Send } from "lucide-react"
import {
  fetchExam,
  gradeExam,
  type ExamAnswerAPI,
  type ExamPaperAPI,
  type ExamResultAPI,
  type ExamTemplateIdAPI,
} from "@/lib/api"
import {
  EXAM_TEMPLATES,
  EXAM_TEMPLATE_IDS,
  formatCountdown,
  inferTemplate,
} from "@/lib/ui/exam-template"
import { Textarea } from "@/components/ui/textarea"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { GenerationProgress, useGenerationProgress } from "./generation-progress"
import { BackButton, EmptyMode } from "./flashcards-view"

type Scope = { kind: "doc"; docId: string } | { kind: "course"; courseId: string }

interface Props {
  courseLabel: string
  scope: Scope
  /** Course signal for the template auto-suggestion. */
  courseName: string
  subjectTags: string[]
  onBack: () => void
}

type Phase = "config" | "loading" | "running" | "grading" | "results"

const GLYPHS = ["A", "B", "C", "D", "E"]
const SNAPSHOT_VERSION = 1

interface ExamSnapshot {
  v: number
  paper: ExamPaperAPI
  answers: Record<string, number | string>
  /** Epoch ms when the exam auto-submits. */
  deadline: number
}

const snapshotKey = (scope: Scope) =>
  `sn:examen:${scope.kind}:${scope.kind === "doc" ? scope.docId : scope.courseId}`

function loadSnapshot(key: string): ExamSnapshot | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const snap = JSON.parse(raw) as ExamSnapshot
    if (snap.v !== SNAPSHOT_VERSION || !snap.paper?.attempt_id) return null
    return snap
  } catch {
    return null
  }
}

const SECTION_KIND_HINT: Record<string, string> = {
  mcq: "Marca la alternativa correcta",
  short: "Responde en 1-3 oraciones",
  dev: "Desarrolla tu respuesta completa",
}

export function ExamView({ courseLabel, scope, courseName, subjectTags, onBack }: Props) {
  const suggested = inferTemplate(subjectTags, courseName)
  const [template, setTemplate] = useState<ExamTemplateIdAPI>(suggested)
  const [phase, setPhase] = useState<Phase>("config")
  const [paper, setPaper] = useState<ExamPaperAPI | null>(null)
  const [answers, setAnswers] = useState<Record<string, number | string>>({})
  const [result, setResult] = useState<ExamResultAPI | null>(null)
  const [deadline, setDeadline] = useState<number | null>(null)
  const [remaining, setRemaining] = useState<number>(0)
  const [error, setError] = useState<string | null>(null)
  // Saved session found on mount → continue / expired / discard screen.
  const [resume, setResume] = useState<ExamSnapshot | null>(null)

  const submittedRef = useRef(false)
  const storageKey = snapshotKey(scope)
  const genProgress = useGenerationProgress(phase === "loading")
  const gradeProgress = useGenerationProgress(phase === "grading")
  const { confirm, confirmDialog } = useConfirm()

  // Refs mirroring the submit inputs so the countdown's auto-submit (a timer
  // callback) always grades the latest answers without re-arming the interval.
  const paperRef = useRef<ExamPaperAPI | null>(null)
  const answersRef = useRef<Record<string, number | string>>({})
  paperRef.current = paper
  answersRef.current = answers

  useEffect(() => {
    setResume(loadSnapshot(storageKey))
  }, [storageKey])

  // Snapshot after every answer/deadline change while the exam runs.
  useEffect(() => {
    if (phase !== "running" || !paper || !deadline) return
    const snap: ExamSnapshot = { v: SNAPSHOT_VERSION, paper, answers, deadline }
    try {
      localStorage.setItem(storageKey, JSON.stringify(snap))
    } catch {
      // Quota/private mode — the exam still works, it just won't survive a refresh.
    }
  }, [phase, paper, answers, deadline, storageKey])

  const submit = useCallback(
    async (auto = false) => {
      const p = paperRef.current
      if (!p || submittedRef.current) return
      if (!auto) {
        const total = p.sections.reduce((n, s) => n + s.items.length, 0)
        const done = Object.values(answersRef.current).filter(
          (v) => typeof v === "number" || (typeof v === "string" && v.trim()),
        ).length
        const ok = await confirm({
          title: "¿Entregar examen?",
          description: `Entrega única: no podrás cambiar tus respuestas. Respondiste ${done} de ${total} preguntas.`,
          confirmLabel: "Entregar",
        })
        if (!ok) return
      }
      submittedRef.current = true
      setPhase("grading")
      setError(null)
      const payload: ExamAnswerAPI[] = Object.entries(answersRef.current)
        .filter(([, v]) => typeof v === "number" || (typeof v === "string" && v.trim()))
        .map(([key, response]) => ({ key, response }))
      try {
        const res = await gradeExam(scope, p.attempt_id, payload)
        setResult(res)
        setPhase("results")
        try {
          localStorage.removeItem(storageKey)
        } catch {
          /* ignore */
        }
      } catch (err) {
        // Fail-closed server side → the attempt is still gradable: keep the
        // answers and let the student retry.
        submittedRef.current = false
        setError(err instanceof Error ? err.message : "No se pudo calificar el examen.")
        setPhase("running")
      }
    },
    [confirm, scope, storageKey],
  )

  // Countdown: derive remaining from the wall-clock deadline (robust to tab
  // throttling); auto-submit exactly once when it reaches 0.
  useEffect(() => {
    if (phase !== "running" || !deadline) return
    const tick = () => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000))
      setRemaining(left)
      if (left <= 0) void submit(true)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [phase, deadline, submit])

  const start = async () => {
    setPhase("loading")
    setError(null)
    try {
      const p = await fetchExam(scope, { template })
      submittedRef.current = false
      setPaper(p)
      setAnswers({})
      setDeadline(Date.now() + p.durationSec * 1000)
      setPhase("running")
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar el examen.")
      setPhase("config")
    }
  }

  const resumeSession = () => {
    if (!resume) return
    submittedRef.current = false
    setPaper(resume.paper)
    setAnswers(resume.answers)
    setTemplate(resume.paper.template)
    setDeadline(resume.deadline)
    setResume(null)
    setPhase("running")
  }

  const submitExpired = () => {
    if (!resume) return
    submittedRef.current = false
    setPaper(resume.paper)
    setAnswers(resume.answers)
    setTemplate(resume.paper.template)
    setDeadline(resume.deadline)
    setResume(null)
    void submit(true)
  }

  const discardSession = () => {
    try {
      localStorage.removeItem(storageKey)
    } catch {
      /* ignore */
    }
    setResume(null)
  }

  // ── Saved session screens ──────────────────────────────────────────────────
  if (resume) {
    const expired = resume.deadline <= Date.now()
    const answered = Object.values(resume.answers).filter(
      (v) => typeof v === "number" || (typeof v === "string" && v.trim()),
    ).length
    return (
      <div className="mx-auto max-w-2xl">
        <BackButton onBack={onBack} />
        <div className="rounded-2xl border border-accent/25 bg-accent/5 p-10 text-center">
          <div className="text-5xl">{expired ? "⏰" : "⏸️"}</div>
          <h2 className="mt-3 text-2xl font-bold">
            {expired ? "Tiempo agotado" : "Tienes un examen en progreso"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {expired
              ? `El tiempo de tu examen anterior terminó. Respondiste ${answered} preguntas — puedes entregarlas o descartar el intento.`
              : `Respondiste ${answered} preguntas · quedan ${formatCountdown(Math.round((resume.deadline - Date.now()) / 1000))}.`}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            {expired ? (
              <button
                onClick={submitExpired}
                className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-accent-foreground transition-opacity hover:opacity-90"
              >
                <Send className="h-4 w-4" /> Entregar respuestas guardadas
              </button>
            ) : (
              <button
                onClick={resumeSession}
                className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-accent-foreground transition-opacity hover:opacity-90"
              >
                Continuar <ArrowRight className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={discardSession}
              className="flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              <RotateCcw className="h-4 w-4" /> Descartar
            </button>
          </div>
        </div>
        {confirmDialog}
      </div>
    )
  }

  // ── Config: template suggestion + override + section preview ──────────────
  if (phase === "config" || (phase === "loading" && !genProgress.visible)) {
    const t = EXAM_TEMPLATES[template]
    return (
      <div className="mx-auto max-w-2xl">
        <BackButton onBack={onBack} />
        <h2 className="text-xl font-bold tracking-tight">Examen</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {courseLabel} · 20 minutos · entrega única · nota /20
        </p>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {EXAM_TEMPLATE_IDS.map((id) => {
            const tpl = EXAM_TEMPLATES[id]
            const active = id === template
            return (
              <button
                key={id}
                onClick={() => setTemplate(id)}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  active ? "border-accent/50 bg-accent/10" : "border-border bg-card hover:border-accent/30"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">{tpl.label}</span>
                  {id === suggested && (
                    <span className="rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                      Sugerido
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">
                  {tpl.description}
                </p>
              </button>
            )
          })}
        </div>

        <div className="mt-5 rounded-2xl border border-border bg-card p-6">
          <h3 className="text-sm font-bold">Estructura del examen · {t.label}</h3>
          <div className="mt-3 flex flex-col gap-2">
            {t.sections.map((s) => (
              <div key={s.kind} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{s.label}</span>
                <span className="font-mono text-xs text-foreground">
                  {s.count} × {s.pointsPerItem} pts
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-sm font-semibold">
            <span className="inline-flex items-center gap-1.5">
              <AlarmClock className="h-4 w-4 text-accent" /> {formatCountdown(t.durationSec)} · se
              entrega solo al acabar el tiempo
            </span>
            <span className="font-mono">20 pts</span>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <div className="mt-5 flex justify-end">
          <button
            onClick={start}
            disabled={phase === "loading"}
            className="flex items-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-bold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {phase === "loading" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                Empezar examen <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
        {confirmDialog}
      </div>
    )
  }

  if (phase === "loading" || genProgress.visible) {
    return (
      <div className="mx-auto max-w-2xl">
        <BackButton onBack={onBack} />
        <GenerationProgress
          pct={genProgress.pct}
          label="Preparando tu examen… la primera vez tarda un poco."
        />
      </div>
    )
  }

  if (phase === "grading" || gradeProgress.visible) {
    return (
      <div className="mx-auto max-w-2xl">
        <BackButton onBack={onBack} />
        <GenerationProgress pct={gradeProgress.pct} label="Calificando tu examen…" />
      </div>
    )
  }

  // ── Results ────────────────────────────────────────────────────────────────
  if (phase === "results" && result) {
    const pct = result.maxTotal > 0 ? result.total / result.maxTotal : 0
    const emoji = pct >= 0.8 ? "🏆" : pct >= 0.55 ? "💪" : "📚"
    const heading =
      pct >= 0.8 ? "¡Excelente examen!" : pct >= 0.55 ? "Aprobado — sigue así" : "A reforzar"
    return (
      <div className="mx-auto max-w-2xl">
        <BackButton onBack={onBack} />
        <div className="rounded-2xl border border-accent/25 bg-accent/5 p-10 text-center">
          <div className="text-5xl">{emoji}</div>
          <h2 className="mt-3 text-2xl font-bold">{heading}</h2>
          <p className="mt-3 text-4xl font-bold tabular-nums text-accent">
            {result.total}
            <span className="text-xl text-muted-foreground"> / {result.maxTotal}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Las preguntas falladas de opción múltiple pasaron a tu Repaso.
          </p>
        </div>

        {result.sections.map((s) => (
          <div key={s.kind} className="mt-5 rounded-2xl border border-border bg-card p-6">
            <h3 className="text-sm font-bold">{s.label}</h3>
            <div className="mt-3 flex flex-col gap-4">
              {s.items.map((it, i) => (
                <div key={it.key} className="rounded-xl border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold leading-snug">
                      {i + 1}. {it.question}
                    </p>
                    <span
                      className={`shrink-0 rounded-md border px-2 py-0.5 font-mono text-xs font-semibold ${
                        it.correct
                          ? "border-accent/40 bg-accent/10 text-accent"
                          : "border-red-500/40 bg-red-500/5 text-red-400"
                      }`}
                    >
                      {it.score}/{it.max}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    <b className="text-foreground">Tu respuesta:</b> {it.yourAnswer}
                  </p>
                  {it.correctAnswer && !it.correct && (
                    <p className="mt-1 text-xs text-accent">
                      <b>Correcta:</b> {it.correctAnswer}
                    </p>
                  )}
                  {it.expectedAnswer && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      <b className="text-foreground">Respuesta esperada:</b> {it.expectedAnswer}
                    </p>
                  )}
                  {it.modelSolution && (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                      <b className="text-foreground">Solución modelo:</b> {it.modelSolution}
                    </p>
                  )}
                  {it.feedback && (
                    <p className="mt-2 rounded-lg bg-secondary/60 p-2.5 text-xs leading-relaxed text-muted-foreground">
                      {it.feedback}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="mt-6 flex justify-center">
          <button
            onClick={onBack}
            className="rounded-xl border border-border px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
          >
            Volver al estudio
          </button>
        </div>
      </div>
    )
  }

  // ── Running: the whole paper, one page ─────────────────────────────────────
  if (!paper) {
    return <EmptyMode onBack={onBack} label="No se pudo cargar el examen. Vuelve a intentarlo." />
  }
  const totalItems = paper.sections.reduce((n, s) => n + s.items.length, 0)
  const answeredCount = Object.values(answers).filter(
    (v) => typeof v === "number" || (typeof v === "string" && v.trim()),
  ).length
  const urgent = remaining < 120

  let itemNumber = 0
  return (
    <div className="mx-auto max-w-2xl">
      <BackButton onBack={onBack} />

      {/* Sticky countdown header — always visible while scrolling the paper. */}
      <div className="sticky top-0 z-10 -mx-2 mb-4 flex items-center justify-between rounded-xl border border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div>
          <h2 className="text-base font-bold tracking-tight">Examen · {courseLabel}</h2>
          <p className="text-xs text-muted-foreground">
            {answeredCount}/{totalItems} respondidas
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-base font-bold tabular-nums ${
            urgent
              ? "border-red-500/50 bg-red-500/10 text-red-400"
              : "border-accent/30 bg-accent/10 text-accent"
          }`}
        >
          <AlarmClock className="h-4 w-4" /> {formatCountdown(remaining)}
        </span>
      </div>

      {paper.sections.map((s) => (
        <div key={s.kind} className="mt-5 rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold">{s.label}</h3>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {s.items.length} × {s.pointsPerItem} pts
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{SECTION_KIND_HINT[s.kind]}</p>

          <div className="mt-4 flex flex-col gap-5">
            {s.items.map((it) => {
              itemNumber += 1
              const n = itemNumber
              if (s.kind === "mcq") {
                const picked = answers[it.key]
                return (
                  <div key={it.key}>
                    <p className="text-sm font-semibold leading-snug">
                      {n}. {it.question}
                    </p>
                    <div className="mt-2.5 flex flex-col gap-2">
                      {(it.options ?? []).map((opt, i) => {
                        const active = picked === i
                        return (
                          <button
                            key={i}
                            onClick={() =>
                              setAnswers((a) => {
                                // Click the marked option again → unmark it.
                                if (a[it.key] === i) {
                                  const { [it.key]: _drop, ...rest } = a
                                  return rest
                                }
                                return { ...a, [it.key]: i }
                              })
                            }
                            className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                              active
                                ? "border-accent/50 bg-accent/10"
                                : "border-border bg-card hover:border-accent/30"
                            }`}
                          >
                            <span
                              className={`flex shrink-0 items-center justify-center rounded-md border font-mono text-xs font-semibold ${
                                active
                                  ? "border-accent/60 text-accent"
                                  : "border-border text-muted-foreground"
                              }`}
                              style={{ width: 26, height: 26 }}
                            >
                              {active ? "X" : GLYPHS[i]}
                            </span>
                            <span className="flex-1 text-sm font-medium leading-snug">{opt}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              }
              const text = typeof answers[it.key] === "string" ? (answers[it.key] as string) : ""
              return (
                <div key={it.key}>
                  <p className="text-sm font-semibold leading-snug">
                    {n}. {it.question}
                  </p>
                  <Textarea
                    value={text}
                    onChange={(e) => setAnswers((a) => ({ ...a, [it.key]: e.target.value }))}
                    placeholder={s.kind === "short" ? "Tu respuesta (1-3 oraciones)…" : "Desarrolla tu respuesta…"}
                    className={`mt-2.5 ${s.kind === "dev" ? "min-h-40" : "min-h-20"}`}
                    maxLength={8000}
                  />
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      <div className="mt-6 flex items-center justify-between rounded-2xl border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          <b className="text-foreground">{answeredCount}</b> de {totalItems} respondidas
        </p>
        <button
          onClick={() => void submit(false)}
          className="flex items-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-bold text-accent-foreground transition-opacity hover:opacity-90"
        >
          <Send className="h-4 w-4" /> Entregar examen
        </button>
      </div>
      {confirmDialog}
    </div>
  )
}
