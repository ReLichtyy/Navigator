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
  /** Results "Enviar fallos a Repaso" → jump into the Repaso queue. */
  onRepaso?: () => void
}

/** Roman numeral for the section index (design shows SECCIÓN I / II / III). */
const ROMAN = ["I", "II", "III", "IV", "V", "VI"]
const SECTION_SHORT: Record<string, string> = { mcq: "Marque X", short: "R. corta", dev: "Desarrollo" }

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

export function ExamView({ courseLabel, scope, courseName, subjectTags, onBack, onRepaso }: Props) {
  const suggested = inferTemplate(subjectTags, courseName)
  const [template, setTemplate] = useState<ExamTemplateIdAPI>(suggested)
  const [phase, setPhase] = useState<Phase>("config")
  const [paper, setPaper] = useState<ExamPaperAPI | null>(null)
  const [answers, setAnswers] = useState<Record<string, number | string>>({})
  const [result, setResult] = useState<ExamResultAPI | null>(null)
  const [deadline, setDeadline] = useState<number | null>(null)
  const [remaining, setRemaining] = useState<number>(0)
  // Seconds actually spent, captured at submit → shown on the grade screen.
  const [usedSec, setUsedSec] = useState(0)
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
  const deadlineRef = useRef<number | null>(null)
  paperRef.current = paper
  answersRef.current = answers
  deadlineRef.current = deadline

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
      // Record how long the attempt actually took (for the grade screen).
      const dl = deadlineRef.current
      setUsedSec(dl ? Math.max(0, p.durationSec - Math.max(0, Math.round((dl - Date.now()) / 1000))) : p.durationSec)
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

  // ── Results — calificación /100 (AreaEstudio.dc 4f) ─────────────────────────
  if (phase === "results" && result) {
    const grade100 = result.maxTotal > 0 ? Math.round((result.total / result.maxTotal) * 100) : 0
    const pass = grade100 >= 60
    // Per-section score aggregates → bars.
    const secBars = result.sections.map((s, i) => {
      const pts = s.items.reduce((n, it) => n + it.score, 0)
      const max = s.items.reduce((n, it) => n + it.max, 0)
      const p = max > 0 ? Math.round((pts / max) * 100) : 0
      return { name: `${ROMAN[i]} · ${SECTION_SHORT[s.kind] ?? s.label}`, frac: `${pts}/${max}`, pct: p, weak: p < 60 }
    })
    const weakest = secBars.reduce((a, b) => (b.pct < a.pct ? b : a), secBars[0])
    const hasMcqFails = result.sections.some((s) => s.kind === "mcq" && s.items.some((it) => !it.correct))
    return (
      <div className="mx-auto max-w-2xl">
        <BackButton onBack={onBack} />

        <div className="text-center">
          <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Tu calificación
          </div>
          <div
            className={`mt-1.5 font-mono text-5xl font-bold leading-none ${pass ? "text-accent" : "text-red-400"}`}
          >
            {grade100}
            <span className="text-2xl text-muted-foreground">/100</span>
          </div>
          <span
            className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-bold ${
              pass
                ? "border-accent/30 bg-accent/10 text-accent"
                : "border-red-500/30 bg-red-500/10 text-red-400"
            }`}
          >
            {pass ? "✓ Aprobado" : "A reforzar"}
          </span>
        </div>

        <div className="mt-6 flex flex-col gap-2.5">
          {secBars.map((b) => (
            <div key={b.name} className="flex items-center gap-3">
              <span className="w-32 shrink-0 text-xs text-muted-foreground">{b.name}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className={`h-full rounded-full ${b.weak ? "bg-amber-500" : "bg-accent"}`}
                  style={{ width: `${b.pct}%` }}
                />
              </div>
              <span className={`shrink-0 font-mono text-[11px] ${b.weak ? "text-amber-500" : "text-accent"}`}>
                {b.frac}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card/60 px-4 py-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <AlarmClock className="h-3.5 w-3.5" /> Tiempo usado:{" "}
            <b className="text-foreground">{formatCountdown(usedSec)}</b> de{" "}
            {formatCountdown(paper?.durationSec ?? 1200)}
          </span>
          {weakest && (
            <span>
              Sección más débil: <b className="text-amber-500">{weakest.name}</b>
            </span>
          )}
        </div>

        <div className="mt-5 flex gap-3">
          {hasMcqFails && onRepaso && (
            <button
              onClick={onRepaso}
              className="flex-1 rounded-xl bg-accent py-3 text-sm font-extrabold text-accent-foreground transition-opacity hover:opacity-90"
            >
              Enviar fallos a Repaso →
            </button>
          )}
          <button
            onClick={onBack}
            className="flex-1 rounded-xl border border-border py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
          >
            Volver al Área de estudio
          </button>
        </div>

        <h3 className="mt-8 text-sm font-bold text-muted-foreground">Revisión por pregunta</h3>
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
      </div>
    )
  }

  // ── Running: sectioned sheet with section-nav (AreaEstudio.dc 4d) ───────────
  if (!paper) {
    return <EmptyMode onBack={onBack} label="No se pudo cargar el examen. Vuelve a intentarlo." />
  }
  const totalItems = paper.sections.reduce((n, s) => n + s.items.length, 0)
  const answeredCount = Object.values(answers).filter(
    (v) => typeof v === "number" || (typeof v === "string" && v.trim()),
  ).length
  const urgentTimer = remaining < 120
  // Per-section answered tally for the left nav (done = every item answered).
  const answeredOf = (s: ExamPaperAPI["sections"][number]) =>
    s.items.filter((it) => {
      const v = answers[it.key]
      return typeof v === "number" || (typeof v === "string" && v.trim())
    }).length

  let itemNumber = 0
  return (
    <div className="mx-auto w-full max-w-4xl">
      <BackButton onBack={onBack} />

      {/* Sticky countdown header — always visible while scrolling the paper. */}
      <div className="sticky top-0 z-10 mb-4 flex items-center justify-between rounded-xl border border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div>
          <h2 className="text-base font-bold tracking-tight">Simulacro · {courseLabel}</h2>
          <p className="text-xs text-muted-foreground">
            {answeredCount}/{totalItems} respondidas
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 font-mono text-base font-bold tabular-nums ${
            urgentTimer
              ? "border-red-500/50 bg-red-500/10 text-red-400"
              : "border-amber-500/40 bg-amber-500/10 text-amber-500"
          }`}
        >
          <AlarmClock className="h-4 w-4" /> {formatCountdown(remaining)}
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[180px_1fr]">
        {/* ── Left: section nav + submit ── */}
        <aside className="flex h-fit flex-col gap-1.5 lg:sticky lg:top-20">
          {paper.sections.map((s, i) => {
            const done = answeredOf(s) === s.items.length && s.items.length > 0
            return (
              <a
                key={s.kind}
                href={`#exam-sec-${i}`}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors ${
                  done ? "bg-accent/[0.06]" : "hover:bg-secondary/50"
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-mono text-[9px] font-bold ${
                    done ? "bg-accent text-accent-foreground" : "border border-border text-muted-foreground"
                  }`}
                >
                  {done ? "✓" : ROMAN[i]}
                </span>
                <span className={`flex-1 truncate text-[12px] font-medium ${done ? "text-accent" : "text-muted-foreground"}`}>
                  {SECTION_SHORT[s.kind] ?? s.label}
                </span>
                <span className="shrink-0 font-mono text-[9.5px] text-muted-foreground">
                  {answeredOf(s)}/{s.items.length}
                </span>
              </a>
            )
          })}
          <div className="mt-2 rounded-lg border border-dashed border-amber-500/25 bg-amber-500/[0.04] px-3 py-2.5 text-[10.5px] leading-snug text-amber-600 dark:text-amber-400/80">
            Al entregar no podrás cambiar respuestas
          </div>
          <button
            onClick={() => void submit(false)}
            className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-[13px] font-extrabold text-accent-foreground transition-opacity hover:opacity-90"
          >
            <Send className="h-4 w-4" /> Entregar examen
          </button>
        </aside>

        {/* ── Right: the paper ── */}
        <div className="flex flex-col gap-6">
          {paper.sections.map((s, si) => {
            // A 2-option MCQ section renders as the "Marque con una X" table.
            const asTable = s.kind === "mcq" && s.items.every((it) => (it.options?.length ?? 0) === 2)
            const cols = asTable ? (s.items[0].options as string[]) : []
            return (
              <div key={s.kind} id={`exam-sec-${si}`} className="scroll-mt-20">
                <div className="mb-2.5 flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[11px] font-bold text-accent">SECCIÓN {ROMAN[si]}</span>
                  <span className="text-sm font-extrabold">{s.label}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {SECTION_KIND_HINT[s.kind]} · {s.pointsPerItem} pts c/u
                  </span>
                </div>

                {asTable ? (
                  <div className="overflow-hidden rounded-xl border border-border">
                    <div className="grid grid-cols-[1fr_56px_56px] border-b border-border bg-secondary/30">
                      <span className="px-3.5 py-2 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                        Afirmación
                      </span>
                      {cols.map((c) => (
                        <span key={c} className="py-2 text-center text-[10.5px] font-bold uppercase text-muted-foreground">
                          {c.trim().charAt(0).toUpperCase()}
                        </span>
                      ))}
                    </div>
                    {s.items.map((it) => {
                      itemNumber += 1
                      const picked = answers[it.key]
                      return (
                        <div
                          key={it.key}
                          className="grid grid-cols-[1fr_56px_56px] items-center border-b border-border/60 last:border-0"
                        >
                          <span className="px-3.5 py-3 text-[12.5px] text-foreground">{it.question}</span>
                          {cols.map((_c, ci) => {
                            const on = picked === ci
                            return (
                              <span key={ci} className="flex justify-center">
                                <button
                                  onClick={() =>
                                    setAnswers((a) =>
                                      a[it.key] === ci
                                        ? (({ [it.key]: _drop, ...rest }) => rest)(a)
                                        : { ...a, [it.key]: ci },
                                    )
                                  }
                                  className={`flex h-[26px] w-[26px] items-center justify-center rounded-md border font-mono text-[13px] font-bold transition-colors ${
                                    on
                                      ? "border-accent bg-accent/15 text-accent"
                                      : "border-border text-transparent hover:border-accent/50"
                                  }`}
                                >
                                  X
                                </button>
                              </span>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {s.items.map((it) => {
                      itemNumber += 1
                      const n = itemNumber
                      if (s.kind === "mcq") {
                        const picked = answers[it.key]
                        return (
                          <div key={it.key} className="rounded-xl border border-border p-3.5">
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
                                      setAnswers((a) =>
                                        a[it.key] === i
                                          ? (({ [it.key]: _drop, ...rest }) => rest)(a)
                                          : { ...a, [it.key]: i },
                                      )
                                    }
                                    className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                                      active
                                        ? "border-accent/50 bg-accent/10"
                                        : "border-border bg-card hover:border-accent/40"
                                    }`}
                                  >
                                    <span
                                      className={`flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-md border font-mono text-[11px] font-bold ${
                                        active ? "border-accent/60 text-accent" : "border-border text-muted-foreground"
                                      }`}
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
                        <div key={it.key} className="rounded-xl border border-border p-3.5">
                          <p className="text-sm font-semibold leading-snug">
                            {n}. {it.question}
                          </p>
                          <Textarea
                            value={text}
                            onChange={(e) => setAnswers((a) => ({ ...a, [it.key]: e.target.value }))}
                            placeholder={s.kind === "short" ? "Escribe tu respuesta…" : "Desarrolla tu respuesta…"}
                            className={`mt-2.5 ${s.kind === "dev" ? "min-h-36" : "min-h-16"}`}
                            maxLength={8000}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      </div>
      {confirmDialog}
    </div>
  )
}
