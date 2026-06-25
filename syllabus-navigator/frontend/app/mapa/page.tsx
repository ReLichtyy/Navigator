"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import { listSyllabi, fetchStudySet, type SyllabusUploadAPI, type StudySetAPI } from "@/lib/api"
import { Network, Loader2, AlertCircle, Layers } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MobileNav } from "@/components/navigator/mobile-nav"
import { SelectionAsk } from "@/components/SelectionAsk"
import { useAskInChat } from "@/hooks/use-ask-in-chat"
import { MindMapCanvas } from "@/components/estudio/mind-map-canvas"
import { CrossCourseView } from "@/components/estudio/cross-course-view"

function isReady(d: SyllabusUploadAPI): boolean {
  return d.status === "processed"
}

function MapaContent() {
  const { status, ready } = useUser()
  const { openAuthModal } = useAuthModal()
  const params = useSearchParams()
  const router = useRouter()

  // Send selected/double-clicked mind-map text to the chat.
  const askInChat = useAskInChat("el mapa mental del curso")

  const [view, setView] = useState<"single" | "cross">("single")
  const [courses, setCourses] = useState<SyllabusUploadAPI[]>([])
  const [coursesLoading, setCoursesLoading] = useState(true)
  const [courseId, setCourseId] = useState<string | null>(null)
  const [studySet, setStudySet] = useState<StudySetAPI | null>(null)
  const [setLoading, setSetLoading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const readyCourses = useMemo(() => courses.filter(isReady), [courses])
  const current = useMemo(
    () => readyCourses.find((c) => c.id === courseId) ?? null,
    [readyCourses, courseId],
  )

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
        const readyOnes = d.uploads.filter(isReady)
        const wanted = params.get("course")
        setCourseId(readyOnes.find((c) => c.id === wanted)?.id ?? readyOnes[0]?.id ?? null)
      })
      .catch(() => alive && setError("No se pudieron cargar los cursos."))
      .finally(() => alive && setCoursesLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, status])

  // The mind map is the study-set's mindmap — same source as Área de Estudio.
  const loadSet = useCallback(async (id: string) => {
    setSetLoading(true)
    setStudySet(null)
    setError(null)
    try {
      setStudySet(await fetchStudySet(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el mapa mental.")
    } finally {
      setSetLoading(false)
    }
  }, [])

  // Regenerate via the edit panel: refresh the set, optionally focused on a topic.
  const regenerate = useCallback(async (id: string, focus: string[]) => {
    setRegenerating(true)
    setError(null)
    try {
      setStudySet(await fetchStudySet(id, { refresh: true, topic: focus[0] }))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo regenerar el mapa.")
    } finally {
      setRegenerating(false)
    }
  }, [])

  useEffect(() => {
    if (courseId) loadSet(courseId)
  }, [courseId, loadSet])

  if (ready && (status === "anonymous" || status === "guest")) {
    return (
      <main className="flex h-dvh w-full items-center justify-center bg-background text-foreground">
        <div className="flex max-w-md flex-col items-center rounded-xl border border-border/60 bg-card p-8 text-center shadow-sm">
          <Network className="mb-4 h-12 w-12 text-accent" />
          <h2 className="mb-2 text-xl font-semibold">Mapa mental</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            Inicia sesión para visualizar los temas de tus cursos como un mapa mental.
          </p>
          <Button variant="accent" size="pill" onClick={() => openAuthModal("signup")}>
            Crear cuenta
          </Button>
        </div>
      </main>
    )
  }

  const courseName = current?.original_filename.replace(/\.pdf$/i, "") ?? ""

  return (
    <main className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-3 sm:px-6">
        <MobileNav />
        <Network className="hidden h-5 w-5 text-accent sm:inline" />
        <h1 className="text-lg font-semibold">Mapa mental</h1>
      </header>

      <div className="flex-1 overflow-auto p-4 sm:px-10 sm:py-9">
        <div className="mx-auto max-w-6xl">
          {coursesLoading ? (
            <CenterSpinner />
          ) : readyCourses.length === 0 ? (
            <Empty />
          ) : (
            <>
              {/* view toggle: single course vs cross-course (Sprint 4) */}
              <div className="mb-4 inline-flex gap-1 rounded-xl border border-border bg-card/50 p-1">
                <ViewTab
                  active={view === "single"}
                  onClick={() => setView("single")}
                  icon={<Network className="h-3.5 w-3.5" />}
                  label="Este curso"
                />
                <ViewTab
                  active={view === "cross"}
                  onClick={() => setView("cross")}
                  icon={<Layers className="h-3.5 w-3.5" />}
                  label="Entre cursos"
                />
              </div>

              {view === "cross" ? (
                <SelectionAsk onAsk={askInChat}>
                  <CrossCourseView />
                </SelectionAsk>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2.5">
                    {readyCourses.map((c) => {
                      const active = c.id === courseId
                      return (
                        <Button
                          key={c.id}
                          variant={active ? "secondary" : "outline"}
                          size="sm"
                          onClick={() => setCourseId(c.id)}
                          className={active ? "border-accent/40 bg-accent/10 text-foreground" : ""}
                        >
                          {c.original_filename.replace(/\.pdf$/i, "")}
                        </Button>
                      )
                    })}
                  </div>

                  <div className="mt-4">
                    {setLoading ? (
                      <CenterSpinner label="Cargando mapa mental…" />
                    ) : error ? (
                      <ErrorBox message={error} onRetry={() => courseId && loadSet(courseId)} />
                    ) : studySet && courseId ? (
                      <SelectionAsk onAsk={askInChat}>
                        <MindMapCanvas
                          mindmap={studySet.mindmap}
                          courseName={courseName}
                          loading={regenerating}
                          onTopicDouble={askInChat}
                          onRegenerate={({ focus }) => regenerate(courseId, focus)}
                        />
                      </SelectionAsk>
                    ) : null}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  )
}

function ViewTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
        active ? "bg-accent/15 text-accent" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
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

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-56 flex-col items-center justify-center rounded-2xl border border-border bg-card p-6 text-center">
      <AlertCircle className="mb-2 h-8 w-8 text-amber-500" />
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="link" onClick={onRetry} className="mt-2 text-accent">
        Reintentar
      </Button>
    </div>
  )
}

function Empty() {
  return (
    <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-border bg-card text-center text-muted-foreground">
      <Network className="mb-3 h-10 w-10 opacity-20" />
      <p className="mb-1 text-sm font-medium">Aún no hay cursos indexados.</p>
      <p className="text-xs">Sube el programa de tu curso en Cursos para generar su mapa mental.</p>
    </div>
  )
}

export default function MapaPage() {
  return (
    <Suspense fallback={<div className="flex h-dvh items-center justify-center">Loading…</div>}>
      <MapaContent />
    </Suspense>
  )
}
