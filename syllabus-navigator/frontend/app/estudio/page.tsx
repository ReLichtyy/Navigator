"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import {
  listSyllabi,
  fetchStudySet,
  fetchSchedule,
  type SyllabusUploadAPI,
  type StudySetAPI,
  type StudyDifficulty,
} from "@/lib/api"
import {
  GraduationCap,
  Loader2,
  AlertCircle,
  HelpCircle,
  Layers,
  RotateCcw,
  Timer,
  Network,
  AlignLeft,
  Zap,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react"
import { FlashcardsView } from "@/components/estudio/flashcards-view"
import { QuizView } from "@/components/estudio/quiz-view"
import { MindView, ResumenView } from "@/components/estudio/mind-resumen-view"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"

type Mode = "menu" | "flash" | "repaso" | "quiz" | "simulacro" | "mind" | "resumen"

function isReady(d: SyllabusUploadAPI): boolean {
  return d.status === "processed"
}

function EstudioContent() {
  const { status, ready } = useUser()
  const { openAuthModal } = useAuthModal()
  const params = useSearchParams()

  const [courses, setCourses] = useState<SyllabusUploadAPI[]>([])
  const [coursesLoading, setCoursesLoading] = useState(true)
  const [courseId, setCourseId] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>("menu")

  const [set, setSet] = useState<StudySetAPI | null>(null)
  const [setLoading, setSetLoading] = useState(false)
  const [setError, setSetError] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)

  // Difficulty + optional topic focus (drives generation).
  const [difficulty, setDifficulty] = useState<StudyDifficulty>("medio")
  const [topic, setTopic] = useState<string | null>(null)
  // Topic recommendations pulled from the course's cronograma (schedule events).
  const [topicRecs, setTopicRecs] = useState<string[]>([])

  const readyCourses = useMemo(() => courses.filter(isReady), [courses])
  const current = useMemo(
    () => readyCourses.find((c) => c.id === courseId) ?? null,
    [readyCourses, courseId],
  )

  // Load the user's courses.
  useEffect(() => {
    if (!ready) return
    if (status === "anonymous" || status === "guest") {
      setCoursesLoading(false)
      return
    }
    let alive = true
    listSyllabi()
      .then((d) => {
        if (!alive) return
        setCourses(d.uploads)
        const ready = d.uploads.filter(isReady)
        const wanted = params.get("course")
        const pick = ready.find((c) => c.id === wanted)?.id ?? ready[0]?.id ?? null
        setCourseId(pick)
      })
      .catch(() => alive && setSetError("No se pudieron cargar los cursos."))
      .finally(() => alive && setCoursesLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, status])

  // Load (or regenerate) the study set for the current course, honoring difficulty/topic.
  const loadSet = useCallback(
    async (id: string, opts: { refresh?: boolean; difficulty?: StudyDifficulty; topic?: string | null } = {}) => {
      if (opts.refresh) setRegenerating(true)
      else {
        setSetLoading(true)
        setSet(null)
      }
      setSetError(null)
      try {
        const data = await fetchStudySet(id, {
          refresh: opts.refresh,
          difficulty: opts.difficulty ?? "medio",
          topic: opts.topic ?? undefined,
        })
        setSet(data)
      } catch (e) {
        setSetError(e instanceof Error ? e.message : "No se pudo generar el material de estudio.")
      } finally {
        setSetLoading(false)
        setRegenerating(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (courseId) loadSet(courseId, { difficulty, topic })
    // Reload only when the course changes; difficulty/topic changes go through explicit handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, loadSet])

  // Topic recommendations from the course cronograma (schedule events).
  useEffect(() => {
    if (!courseId) {
      setTopicRecs([])
      return
    }
    let alive = true
    fetchSchedule(courseId)
      .then((d) => {
        if (!alive) return
        const titles = d.events.map((e) => e.title.trim()).filter(Boolean)
        setTopicRecs(Array.from(new Set(titles)).slice(0, 12))
      })
      .catch(() => alive && setTopicRecs([]))
    return () => {
      alive = false
    }
  }, [courseId])

  // Apply a difficulty change → regenerate with it.
  const applyDifficulty = (d: StudyDifficulty) => {
    setDifficulty(d)
    if (courseId) loadSet(courseId, { difficulty: d, topic })
  }
  // Apply a topic focus (or clear it) → regenerate.
  const applyTopic = (t: string | null) => {
    setTopic(t)
    if (courseId) loadSet(courseId, { difficulty, topic: t })
  }

  // Recommendations = cronograma topics + mind-map branch labels (deduped).
  const recommendations = useMemo(() => {
    const fromMap = set?.mindmap.branches.map((b) => b.label.trim()).filter(Boolean) ?? []
    return Array.from(new Set([...topicRecs, ...fromMap])).slice(0, 14)
  }, [topicRecs, set])

  // Honor ?mode= deep links once a set is available.
  useEffect(() => {
    const m = params.get("mode") as Mode | null
    if (m && set && ["flash", "repaso", "quiz", "simulacro", "mind", "resumen"].includes(m)) {
      setMode(m)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set])

  const pickCourse = (id: string) => {
    setCourseId(id)
    setMode("menu")
    setDifficulty("medio")
    setTopic(null)
  }
  const backToMenu = () => setMode("menu")

  // ---------- gates ----------
  if (ready && (status === "anonymous" || status === "guest")) {
    return (
      <Gate onSignup={() => openAuthModal("signup")} />
    )
  }

  return (
    <main className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-6">
        <GraduationCap className="h-5 w-5 text-accent" />
        <h1 className="text-lg font-semibold">Área de Estudio</h1>
        <Badge variant="new" className="ml-1 uppercase">Nuevo</Badge>
      </header>

      <div className="flex-1 overflow-auto p-6 sm:px-10 sm:py-9">
        <div className="mx-auto max-w-4xl">
          {coursesLoading ? (
            <CenterSpinner />
          ) : readyCourses.length === 0 ? (
            <EmptyCourses />
          ) : (
            <>
              {/* Course picker — always visible */}
              <div className="flex flex-wrap gap-2.5">
                {readyCourses.map((c) => {
                  const active = c.id === courseId
                  return (
                    <Button
                      key={c.id}
                      variant={active ? "secondary" : "outline"}
                      onClick={() => pickCourse(c.id)}
                      className={active ? "border-accent/40 bg-accent/10 text-foreground" : "text-muted-foreground"}
                    >
                      {c.original_filename.replace(/\.pdf$/i, "")}
                    </Button>
                  )
                })}
              </div>

              <div className="mt-6">
                {setLoading ? (
                  <CenterSpinner label="Generando material de estudio…" />
                ) : setError ? (
                  <SetError message={setError} onRetry={() => courseId && loadSet(courseId)} />
                ) : set && current ? (
                  <ModeRouter
                    mode={mode}
                    set={set}
                    courseId={current.id}
                    courseName={current.original_filename.replace(/\.pdf$/i, "")}
                    regenerating={regenerating}
                    onRegenerate={() => courseId && loadSet(courseId, { refresh: true, difficulty, topic })}
                    setMode={setMode}
                    backToMenu={backToMenu}
                    difficulty={difficulty}
                    topic={topic}
                    recommendations={recommendations}
                    onDifficulty={applyDifficulty}
                    onTopic={applyTopic}
                  />
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

function ModeRouter({
  mode,
  set,
  courseId,
  courseName,
  regenerating,
  onRegenerate,
  setMode,
  backToMenu,
  difficulty,
  topic,
  recommendations,
  onDifficulty,
  onTopic,
}: {
  mode: Mode
  set: StudySetAPI
  courseId: string
  courseName: string
  regenerating: boolean
  onRegenerate: () => void
  setMode: (m: Mode) => void
  backToMenu: () => void
  difficulty: StudyDifficulty
  topic: string | null
  recommendations: string[]
  onDifficulty: (d: StudyDifficulty) => void
  onTopic: (t: string | null) => void
}) {
  switch (mode) {
    case "flash":
      return <FlashcardsView title="Tarjetas dinámicas" courseLabel={courseName} cards={set.flashcards} onBack={backToMenu} syllabusId={courseId} />
    case "repaso":
      return <FlashcardsView title="Modo repaso" courseLabel={courseName} cards={set.flashcards} onBack={backToMenu} syllabusId={courseId} />
    case "quiz":
      return <QuizView title="Quiz dinámico" courseLabel={courseName} questions={set.quiz} onBack={backToMenu} />
    case "simulacro":
      return <QuizView title="Simulacro · Prueba corta" courseLabel={courseName} questions={set.quiz} onBack={backToMenu} />
    case "mind":
      return <MindView courseLabel={courseName} mindmap={set.mindmap} onBack={backToMenu} />
    case "resumen":
      return (
        <ResumenView
          courseName={courseName}
          summary={set.summary}
          regenerating={regenerating}
          onRegenerate={onRegenerate}
          onFlash={() => setMode("flash")}
          onQuiz={() => setMode("quiz")}
          onBack={backToMenu}
        />
      )
    default:
      return (
        <Menu
          set={set}
          courseName={courseName}
          setMode={setMode}
          difficulty={difficulty}
          topic={topic}
          recommendations={recommendations}
          onDifficulty={onDifficulty}
          onTopic={onTopic}
        />
      )
  }
}

const MODES: { key: Mode; title: string; desc: string; Icon: typeof HelpCircle; meta: (s: StudySetAPI) => string }[] = [
  { key: "quiz", title: "Quiz dinámico", desc: "Preguntas de opción múltiple generadas de tus documentos.", Icon: HelpCircle, meta: (s) => `${s.quiz.length} preg.` },
  { key: "flash", title: "Tarjetas dinámicas", desc: "Flashcards de concepto → definición con repetición espaciada.", Icon: Layers, meta: (s) => `${s.flashcards.length} tarjetas` },
  { key: "repaso", title: "Modo repaso", desc: "Repasa las tarjetas del curso, una a una.", Icon: RotateCcw, meta: () => "SRS" },
  { key: "simulacro", title: "Simulacro · Prueba corta", desc: "Examen con el formato de la próxima evaluación.", Icon: Timer, meta: () => "cronometrado" },
  { key: "mind", title: "Mapa mental", desc: "Estructura visual de los temas y cómo se conectan.", Icon: Network, meta: () => "visual" },
  { key: "resumen", title: "Resumen automático", desc: "Síntesis de los temas clave, lista para repasar.", Icon: AlignLeft, meta: () => "auto" },
]

const DIFFICULTIES: { key: StudyDifficulty; label: string; hint: string }[] = [
  { key: "facil", label: "Fácil", hint: "Conceptos base, recordar" },
  { key: "medio", label: "Medio", hint: "Equilibrado" },
  { key: "dificil", label: "Difícil", hint: "Razonar, aplicar, casos límite" },
]

function Menu({
  set,
  courseName,
  setMode,
  difficulty,
  topic,
  recommendations,
  onDifficulty,
  onTopic,
}: {
  set: StudySetAPI
  courseName: string
  setMode: (m: Mode) => void
  difficulty: StudyDifficulty
  topic: string | null
  recommendations: string[]
  onDifficulty: (d: StudyDifficulty) => void
  onTopic: (t: string | null) => void
}) {
  const [topicOpen, setTopicOpen] = useState(false)
  return (
    <div>
      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
        Material de estudio generado dinámicamente desde el knowledge base del curso. Ajusta la
        dificultad y, si quieres, enfócalo en un tema; luego elige un modo.
      </p>

      <Card className="mt-5 flex-row items-center gap-3 p-3.5">
        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-accent/10">
          <Zap className="h-4 w-4 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-foreground">
            <b>{courseName}</b> · carpeta de knowledge propia
          </div>
        </div>
        <Badge variant="accent" className="flex-none">● Indexado</Badge>
      </Card>

      {/* ─── Difficulty + topic focus ─── */}
      <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-border/70 bg-card/40 p-4 sm:flex-row sm:items-start sm:gap-6">
        {/* Difficulty */}
        <div className="flex-1">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Dificultad
          </div>
          <div className="flex gap-2">
            {DIFFICULTIES.map((d) => {
              const active = d.key === difficulty
              return (
                <button
                  key={d.key}
                  onClick={() => !active && onDifficulty(d.key)}
                  title={d.hint}
                  className={`flex-1 rounded-xl border px-3 py-2 text-center transition-colors ${
                    active
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  <div className="text-sm font-bold">{d.label}</div>
                  <div className="mt-0.5 text-[10px] leading-tight opacity-80">{d.hint}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Topic focus */}
        <div className="flex-1">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" /> Tema (opcional)
          </div>
          {topic ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-medium text-accent">
                <span className="truncate">{topic}</span>
                <button onClick={() => onTopic(null)} aria-label="Quitar tema" className="shrink-0 hover:opacity-70">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
          ) : (
            <>
              <button
                onClick={() => setTopicOpen((v) => !v)}
                className="w-full rounded-xl border border-border px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary"
              >
                {recommendations.length > 0
                  ? "Elige un tema del cronograma…"
                  : "Todo el curso (sin tema específico)"}
              </button>
              {topicOpen && recommendations.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {recommendations.map((r) => (
                    <button
                      key={r}
                      onClick={() => {
                        onTopic(r)
                        setTopicOpen(false)
                      }}
                      className="rounded-lg border border-border bg-secondary/40 px-2.5 py-1 text-xs text-foreground transition-colors hover:border-accent/40 hover:bg-accent/10"
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {MODES.map((m) => (
          <Card
            key={m.key}
            asChild
            className="cursor-pointer gap-0 p-5 transition-all hover:-translate-y-0.5 hover:border-accent/40"
          >
            <button onClick={() => setMode(m.key)} className="text-left">
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
                  <m.Icon className="h-5 w-5 text-accent" />
                </div>
                <span className="font-mono text-xs text-muted-foreground">{m.meta(set)}</span>
              </div>
              <div className="mt-3.5 text-[15px] font-bold text-foreground">{m.title}</div>
              <div className="mt-1 text-[13px] leading-snug text-muted-foreground">{m.desc}</div>
            </button>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ---------- small presentational helpers ----------

function CenterSpinner({ label }: { label?: string }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  )
}

function SetError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-56 flex-col items-center justify-center rounded-2xl border border-border bg-card p-6 text-center">
      <AlertCircle className="mb-2 h-8 w-8 text-amber-500" />
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="link" onClick={onRetry} className="mt-3 text-accent">
        Reintentar
      </Button>
    </div>
  )
}

function EmptyCourses() {
  return (
    <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-border bg-card text-center text-muted-foreground">
      <GraduationCap className="mb-3 h-10 w-10 opacity-20" />
      <p className="mb-1 text-sm font-medium">Aún no hay cursos indexados.</p>
      <p className="text-xs">Sube un sílabo en la Knowledge Base para generar material de estudio.</p>
    </div>
  )
}

function Gate({ onSignup }: { onSignup: () => void }) {
  return (
    <main className="flex h-dvh w-full items-center justify-center bg-background text-foreground">
      <div className="flex max-w-md flex-col items-center rounded-xl border border-border/60 bg-card p-8 text-center shadow-sm">
        <GraduationCap className="mb-4 h-12 w-12 text-accent" />
        <h2 className="mb-2 text-xl font-semibold">Área de Estudio</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          Inicia sesión para generar quizzes, tarjetas y resúmenes desde tus cursos.
        </p>
        <Button variant="accent" size="pill" onClick={onSignup}>
          Crear cuenta
        </Button>
      </div>
    </main>
  )
}

export default function EstudioPage() {
  return (
    <Suspense fallback={<div className="flex h-dvh items-center justify-center">Loading…</div>}>
      <EstudioContent />
    </Suspense>
  )
}
