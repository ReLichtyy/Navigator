"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import {
  listSyllabi,
  fetchStudySet,
  fetchSchedule,
  fetchRecommendations,
  renameDocument,
  type SyllabusUploadAPI,
  type StudySetAPI,
  type StudyDifficulty,
  type ScheduleEventAPI,
  type WeeklyPlanAPI,
} from "@/lib/api"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { pickWeekTopics } from "@/lib/ui/week-topics"
import { pickStudySuggestion, type StudySuggestion } from "@/lib/ui/study-suggestion"
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
  Pencil,
  Check,
} from "lucide-react"
import { FlashcardsView } from "@/components/estudio/flashcards-view"
import { QuizView } from "@/components/estudio/quiz-view"
import { MindView, ResumenView } from "@/components/estudio/mind-resumen-view"
import type { MindCourse } from "@/components/estudio/mind-map-canvas"
import { MasteryPanel } from "@/components/estudio/mastery-panel"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"

type Mode = "menu" | "flash" | "repaso" | "quiz" | "simulacro" | "mind" | "resumen"

function isReady(d: SyllabusUploadAPI): boolean {
  return d.status === "processed"
}

const cleanName = (f: string) => f.replace(/\.pdf$/i, "")
// Short mono code for a course pill (no real code in the data → derive a stable one).
const courseCode = (i: number) => `C-${String(i + 1).padStart(2, "0")}`

function EstudioContent() {
  const { status, ready } = useUser()
  const { openAuthModal } = useAuthModal()
  const params = useSearchParams()
  const router = useRouter()

  const [courses, setCourses] = useState<SyllabusUploadAPI[]>([])
  const [coursesLoading, setCoursesLoading] = useState(true)
  const [courseId, setCourseId] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>("menu")

  const [set, setSet] = useState<StudySetAPI | null>(null)
  const [setLoading, setSetLoading] = useState(false)
  const [setError, setSetError] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)

  // Difficulty + optional topic focus. Instant UI selections; applied when a mode launches.
  const [difficulty, setDifficulty] = useState<StudyDifficulty>("medio")
  const [topic, setTopic] = useState<string | null>(null)
  // The (difficulty|topic) signature the currently-loaded `set` was generated with.
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  // The selected course's cronograma events + the user's weekly plan (for week-topic chips).
  const [courseEvents, setCourseEvents] = useState<ScheduleEventAPI[]>([])
  const [plan, setPlan] = useState<WeeklyPlanAPI | null>(null)

  // Inline course rename (id/reference never changes — only original_filename).
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [savingRename, setSavingRename] = useState(false)

  const paramKey = (d: StudyDifficulty, t: string | null) => `${d}::${t ?? ""}`

  const readyCourses = useMemo(() => courses.filter(isReady), [courses])
  const current = useMemo(
    () => readyCourses.find((c) => c.id === courseId) ?? null,
    [readyCourses, courseId],
  )
  // Course pills for the mind-map view (code + short label).
  const mindCourses = useMemo<MindCourse[]>(
    () =>
      readyCourses.map((c, i) => ({
        id: c.id,
        code: courseCode(i),
        label: cleanName(c.original_filename),
      })),
    [readyCourses],
  )
  const currentCode = useMemo(() => {
    const i = readyCourses.findIndex((c) => c.id === courseId)
    return i >= 0 ? courseCode(i) : ""
  }, [readyCourses, courseId])

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
    async (
      id: string,
      opts: { refresh?: boolean; difficulty?: StudyDifficulty; topic?: string | null } = {},
    ) => {
      const d = opts.difficulty ?? "medio"
      const t = opts.topic ?? null
      if (opts.refresh) setRegenerating(true)
      else {
        setSetLoading(true)
        setSet(null)
      }
      setSetError(null)
      try {
        const data = await fetchStudySet(id, {
          refresh: opts.refresh,
          difficulty: d,
          topic: t ?? undefined,
        })
        setSet(data)
        setLoadedKey(paramKey(d, t))
      } catch (e) {
        setSetError(e instanceof Error ? e.message : "No se pudo generar el material de estudio.")
      } finally {
        setSetLoading(false)
        setRegenerating(false)
      }
    },
    [],
  )

  // Base set for the menu (medium, whole course). Reloads only when the course changes.
  useEffect(() => {
    if (courseId) loadSet(courseId, { difficulty: "medio", topic: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, loadSet])

  // The selected course's cronograma events (for week-topic suggestions).
  useEffect(() => {
    if (!courseId) {
      setCourseEvents([])
      return
    }
    let alive = true
    fetchSchedule(courseId)
      .then((d) => alive && setCourseEvents(d.events))
      .catch(() => alive && setCourseEvents([]))
    return () => {
      alive = false
    }
  }, [courseId])

  // Weekly plan (today + week range), once — used to rank week-relevant topics.
  useEffect(() => {
    let alive = true
    fetchRecommendations()
      .then((p) => alive && setPlan(p))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // 3 topic suggestions for the current week of the selected course.
  const weekTopics = useMemo(
    () =>
      pickWeekTopics(
        courseEvents,
        { today: plan?.today, weekStart: plan?.week_start, weekEnd: plan?.week_end },
        3,
      ),
    [courseEvents, plan],
  )

  // The single most relevant mode for the current course (drives the "Sugerido" badge).
  const suggestion = useMemo(
    () => pickStudySuggestion(courseEvents, plan?.today, weekTopics.length > 0),
    [courseEvents, plan, weekTopics],
  )

  // Difficulty / topic are instant selections; they apply when a mode launches.
  const applyDifficulty = (d: StudyDifficulty) => setDifficulty(d)
  const applyTopic = (t: string | null) => setTopic(t)

  // Launch a mode, regenerating the set for the chosen difficulty/topic if needed.
  const launchMode = async (m: Mode) => {
    // The mind map lives on its own page now — redirect there with the course.
    if (m === "mind") {
      if (courseId) router.push(`/mapa?course=${courseId}`)
      return
    }
    if (courseId && loadedKey !== paramKey(difficulty, topic)) {
      await loadSet(courseId, { difficulty, topic })
    }
    setMode(m)
  }

  // Honor ?mode= deep links once a set is available.
  useEffect(() => {
    const m = params.get("mode") as Mode | null
    if (m === "mind") {
      if (courseId) router.push(`/mapa?course=${courseId}`)
      return
    }
    if (m && set && ["flash", "repaso", "quiz", "simulacro", "resumen"].includes(m)) {
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

  // ----- course rename (reference/id unchanged) -----
  const startRename = (c: SyllabusUploadAPI) => {
    setRenamingId(c.id)
    setRenameValue(c.original_filename.replace(/\.pdf$/i, ""))
  }
  const commitRename = async (id: string) => {
    const name = renameValue.trim()
    if (!name) return
    setSavingRename(true)
    try {
      const { upload } = await renameDocument(id, name)
      setCourses((prev) =>
        prev.map((c) => (c.id === id ? { ...c, original_filename: upload.original_filename } : c)),
      )
      setRenamingId(null)
    } catch {
      toast.error("No se pudo renombrar el curso.")
    } finally {
      setSavingRename(false)
    }
  }

  // ---------- gates ----------
  if (ready && (status === "anonymous" || status === "guest")) {
    return <Gate onSignup={() => openAuthModal("signup")} />
  }

  return (
    <main className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-6">
        <GraduationCap className="h-5 w-5 text-accent" />
        <h1 className="text-lg font-semibold">Área de Estudio</h1>
        <Badge variant="new" className="ml-1 uppercase">
          Nuevo
        </Badge>
      </header>

      <div className="flex-1 overflow-auto p-6 sm:px-10 sm:py-9">
        <div className="mx-auto max-w-4xl">
          {coursesLoading ? (
            <CenterSpinner />
          ) : readyCourses.length === 0 ? (
            <EmptyCourses />
          ) : (
            <>
              {/* Course picker — always visible; double-click (or pencil) to rename */}
              <div className="flex flex-wrap gap-2.5">
                {readyCourses.map((c) => {
                  const active = c.id === courseId
                  if (renamingId === c.id) {
                    return (
                      <div
                        key={c.id}
                        className="flex items-center gap-1 rounded-lg border border-accent/40 bg-accent/5 px-1.5 py-1"
                      >
                        <Input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename(c.id)
                            else if (e.key === "Escape") setRenamingId(null)
                          }}
                          className="h-7 w-44 text-sm"
                        />
                        <Button
                          size="icon-sm"
                          variant="accent"
                          disabled={savingRename || !renameValue.trim()}
                          onClick={() => commitRename(c.id)}
                          aria-label="Guardar nombre"
                        >
                          {savingRename ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => setRenamingId(null)}
                          aria-label="Cancelar"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )
                  }
                  return (
                    <div key={c.id} className="group relative">
                      <Button
                        variant={active ? "secondary" : "outline"}
                        onClick={() => pickCourse(c.id)}
                        onDoubleClick={() => startRename(c)}
                        className={
                          active
                            ? "border-accent/40 bg-accent/10 pr-8 text-foreground"
                            : "text-muted-foreground"
                        }
                        title="Doble-click para renombrar"
                      >
                        {c.original_filename.replace(/\.pdf$/i, "")}
                      </Button>
                      {active && (
                        <button
                          onClick={() => startRename(c)}
                          aria-label="Renombrar curso"
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-accent group-hover:opacity-100"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
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
                    courseCode={currentCode}
                    courseName={cleanName(current.original_filename)}
                    mindCourses={mindCourses}
                    onPickCourse={(id) => {
                      // Switch course but stay in the mind-map view (unlike the top picker).
                      setCourseId(id)
                      setDifficulty("medio")
                      setTopic(null)
                    }}
                    regenerating={regenerating}
                    onRegenerate={() =>
                      courseId && loadSet(courseId, { refresh: true, difficulty, topic })
                    }
                    setMode={setMode}
                    onLaunch={launchMode}
                    backToMenu={backToMenu}
                    difficulty={difficulty}
                    topic={topic}
                    weekTopics={weekTopics}
                    suggestion={suggestion}
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
  courseCode,
  courseName,
  mindCourses,
  onPickCourse,
  regenerating,
  onRegenerate,
  setMode,
  onLaunch,
  backToMenu,
  difficulty,
  topic,
  weekTopics,
  suggestion,
  onDifficulty,
  onTopic,
}: {
  mode: Mode
  set: StudySetAPI
  courseId: string
  courseCode: string
  courseName: string
  mindCourses: MindCourse[]
  onPickCourse: (id: string) => void
  regenerating: boolean
  onRegenerate: () => void
  setMode: (m: Mode) => void
  onLaunch: (m: Mode) => void
  backToMenu: () => void
  difficulty: StudyDifficulty
  topic: string | null
  weekTopics: string[]
  suggestion: StudySuggestion | null
  onDifficulty: (d: StudyDifficulty) => void
  onTopic: (t: string | null) => void
}) {
  switch (mode) {
    case "flash":
      return (
        <FlashcardsView
          title="Tarjetas dinámicas"
          courseLabel={courseName}
          cards={set.flashcards}
          onBack={backToMenu}
          syllabusId={courseId}
        />
      )
    case "repaso":
      return (
        <FlashcardsView
          title="Modo repaso"
          courseLabel={courseName}
          cards={set.flashcards}
          onBack={backToMenu}
          syllabusId={courseId}
        />
      )
    case "quiz":
      return (
        <QuizView
          title="Quiz dinámico"
          courseLabel={courseName}
          questions={set.quiz}
          syllabusId={courseId}
          onBack={backToMenu}
        />
      )
    case "simulacro":
      return (
        <QuizView
          title="Simulacro · Prueba corta"
          courseLabel={courseName}
          questions={set.quiz}
          syllabusId={courseId}
          onBack={backToMenu}
        />
      )
    case "mind":
      return (
        <MindView
          courseCode={courseCode}
          courseLabel={courseName}
          mindmap={set.mindmap}
          courses={mindCourses}
          activeCourseId={courseId}
          onPickCourse={onPickCourse}
          regenerating={regenerating}
          onRegenerate={onRegenerate}
          onBack={backToMenu}
        />
      )
    case "resumen":
      return (
        <ResumenView
          courseName={courseName}
          summary={set.summary}
          studyGuide={set.studyGuide}
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
          courseId={courseId}
          courseName={courseName}
          onLaunch={onLaunch}
          difficulty={difficulty}
          topic={topic}
          weekTopics={weekTopics}
          suggestion={suggestion}
          onDifficulty={onDifficulty}
          onTopic={onTopic}
        />
      )
  }
}

const MODES: {
  key: Mode
  title: string
  desc: string
  Icon: typeof HelpCircle
  meta: (s: StudySetAPI) => string
}[] = [
  {
    key: "quiz",
    title: "Quiz dinámico",
    desc: "Preguntas de opción múltiple generadas de tus documentos.",
    Icon: HelpCircle,
    meta: (s) => `${s.quiz.length} preg.`,
  },
  {
    key: "flash",
    title: "Tarjetas dinámicas",
    desc: "Flashcards de concepto → definición con repetición espaciada.",
    Icon: Layers,
    meta: (s) => `${s.flashcards.length} tarjetas`,
  },
  {
    key: "repaso",
    title: "Modo repaso",
    desc: "Repasa las tarjetas del curso, una a una.",
    Icon: RotateCcw,
    meta: () => "SRS",
  },
  {
    key: "simulacro",
    title: "Simulacro · Prueba corta",
    desc: "Examen con el formato de la próxima evaluación.",
    Icon: Timer,
    meta: () => "cronometrado",
  },
  {
    key: "mind",
    title: "Mapa mental",
    desc: "Estructura visual de los temas y cómo se conectan.",
    Icon: Network,
    meta: () => "visual",
  },
  {
    key: "resumen",
    title: "Resumen automático",
    desc: "Síntesis de los temas clave, lista para repasar.",
    Icon: AlignLeft,
    meta: () => "auto",
  },
]

// Max focus-instruction length — mirrors the server cap in app/api/study/[syllabusId]/route.ts.
const MAX_TOPIC = 160

const DIFFICULTIES: { key: StudyDifficulty; label: string; hint: string }[] = [
  { key: "facil", label: "Fácil", hint: "Conceptos base, recordar" },
  { key: "medio", label: "Medio", hint: "Equilibrado" },
  { key: "dificil", label: "Difícil", hint: "Razonar, aplicar, casos límite" },
]

function Menu({
  set,
  courseId,
  courseName,
  onLaunch,
  difficulty,
  topic,
  weekTopics,
  suggestion,
  onDifficulty,
  onTopic,
}: {
  set: StudySetAPI
  courseId: string
  courseName: string
  onLaunch: (m: Mode) => void
  difficulty: StudyDifficulty
  topic: string | null
  weekTopics: string[]
  suggestion: StudySuggestion | null
  onDifficulty: (d: StudyDifficulty) => void
  onTopic: (t: string | null) => void
}) {
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
        <Badge variant="accent" className="flex-none">
          ● Indexado
        </Badge>
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

        {/* Focus instruction — free-text prompt + week-topic shortcuts */}
        <div className="flex-1">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" /> Instrucción de enfoque (opcional)
          </div>
          <p className="mb-2 text-[11px] text-muted-foreground/80">
            Escribe en qué enfocar el material (un tema o una instrucción), o déjalo en blanco para
            todo el curso.
          </p>
          <div className="relative">
            <Textarea
              value={topic ?? ""}
              onChange={(e) => onTopic(e.target.value.trimStart() || null)}
              maxLength={MAX_TOPIC}
              placeholder="ej: solo ejercicios prácticos de derivadas, con casos límite"
              className="min-h-[4.5rem] resize-none pb-6 text-[13px]"
            />
            <span className="pointer-events-none absolute bottom-1.5 right-2 text-[10px] tabular-nums text-muted-foreground/70">
              {topic?.length ?? 0}/{MAX_TOPIC}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
              Atajos
            </span>
            <TopicChip label="General" active={!topic} onClick={() => onTopic(null)} />
            {weekTopics.map((t) => (
              <TopicChip key={t} label={t} active={topic === t} onClick={() => onTopic(t)} />
            ))}
          </div>
        </div>
      </div>

      <MasteryPanel syllabusId={courseId} />

      <div className="mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {MODES.map((m) => {
          const suggested = suggestion?.mode === m.key
          return (
            <Card
              key={m.key}
              asChild
              className={`cursor-pointer gap-0 p-5 transition-all hover:-translate-y-0.5 hover:border-accent/40 ${
                suggested ? "border-accent/50 bg-accent/[0.04] ring-1 ring-accent/30" : ""
              }`}
            >
              <button onClick={() => onLaunch(m.key)} className="text-left">
                <div className="flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
                    <m.Icon className="h-5 w-5 text-accent" />
                  </div>
                  {suggested ? (
                    <Badge variant="accent" className="gap-1">
                      <Sparkles className="h-3 w-3" />
                      Sugerido · {suggestion!.reason}
                    </Badge>
                  ) : (
                    <span className="font-mono text-xs text-muted-foreground">{m.meta(set)}</span>
                  )}
                </div>
                <div className="mt-3.5 text-[15px] font-bold text-foreground">{m.title}</div>
                <div className="mt-1 text-[13px] leading-snug text-muted-foreground">{m.desc}</div>
              </button>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ---------- small presentational helpers ----------

function TopicChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`max-w-[15rem] truncate rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "border-accent bg-accent/15 text-accent shadow-[0_0_0_1px_rgba(63,191,132,0.25)]"
          : "border-border bg-secondary/40 text-muted-foreground hover:border-accent/40 hover:bg-accent/10 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  )
}

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
      <p className="text-xs">
        Sube un sílabo en la Knowledge Base para generar material de estudio.
      </p>
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
