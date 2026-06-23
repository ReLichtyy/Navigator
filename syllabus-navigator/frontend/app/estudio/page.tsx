"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import { listSyllabi, fetchStudySet, type SyllabusUploadAPI, type StudySetAPI } from "@/lib/api"
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
} from "lucide-react"
import { FlashcardsView } from "@/components/estudio/flashcards-view"
import { QuizView } from "@/components/estudio/quiz-view"
import { MindView, ResumenView } from "@/components/estudio/mind-resumen-view"

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

  // Load (or regenerate) the study set for the current course.
  const loadSet = useCallback(async (id: string, refresh = false) => {
    if (refresh) setRegenerating(true)
    else {
      setSetLoading(true)
      setSet(null)
    }
    setSetError(null)
    try {
      const data = await fetchStudySet(id, refresh)
      setSet(data)
    } catch (e) {
      setSetError(e instanceof Error ? e.message : "No se pudo generar el material de estudio.")
    } finally {
      setSetLoading(false)
      setRegenerating(false)
    }
  }, [])

  useEffect(() => {
    if (courseId) loadSet(courseId)
  }, [courseId, loadSet])

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
        <span className="ml-1 rounded-md bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-foreground">
          Nuevo
        </span>
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
                    <button
                      key={c.id}
                      onClick={() => pickCourse(c.id)}
                      className={`rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors ${
                        active
                          ? "border-accent/40 bg-accent/10 text-foreground"
                          : "border-border bg-card text-muted-foreground hover:border-accent/30"
                      }`}
                    >
                      {c.original_filename.replace(/\.pdf$/i, "")}
                    </button>
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
                    courseName={current.original_filename.replace(/\.pdf$/i, "")}
                    regenerating={regenerating}
                    onRegenerate={() => courseId && loadSet(courseId, true)}
                    setMode={setMode}
                    backToMenu={backToMenu}
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
  courseName,
  regenerating,
  onRegenerate,
  setMode,
  backToMenu,
}: {
  mode: Mode
  set: StudySetAPI
  courseName: string
  regenerating: boolean
  onRegenerate: () => void
  setMode: (m: Mode) => void
  backToMenu: () => void
}) {
  switch (mode) {
    case "flash":
      return <FlashcardsView title="Tarjetas dinámicas" courseLabel={courseName} cards={set.flashcards} onBack={backToMenu} />
    case "repaso":
      return <FlashcardsView title="Modo repaso" courseLabel={courseName} cards={set.flashcards} onBack={backToMenu} />
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
      return <Menu set={set} courseName={courseName} setMode={setMode} />
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

function Menu({ set, courseName, setMode }: { set: StudySetAPI; courseName: string; setMode: (m: Mode) => void }) {
  return (
    <div>
      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
        Material de estudio generado dinámicamente desde el knowledge base del curso. Elige un modo
        para empezar.
      </p>

      <div className="mt-5 flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5">
        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-accent/10">
          <Zap className="h-4 w-4 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-foreground">
            <b>{courseName}</b> · carpeta de knowledge propia
          </div>
        </div>
        <span className="flex-none rounded-lg border border-accent/25 bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
          ● Indexado
        </span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className="flex flex-col rounded-2xl border border-border bg-card p-5 text-left transition-all hover:-translate-y-0.5 hover:border-accent/40"
          >
            <div className="flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
                <m.Icon className="h-5 w-5 text-accent" />
              </div>
              <span className="font-mono text-xs text-muted-foreground">{m.meta(set)}</span>
            </div>
            <div className="mt-3.5 text-[15px] font-bold text-foreground">{m.title}</div>
            <div className="mt-1 text-[13px] leading-snug text-muted-foreground">{m.desc}</div>
          </button>
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
      <button onClick={onRetry} className="mt-3 text-sm text-accent underline hover:text-accent/80">
        Reintentar
      </button>
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
        <button
          onClick={onSignup}
          className="rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90"
        >
          Crear cuenta
        </button>
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
