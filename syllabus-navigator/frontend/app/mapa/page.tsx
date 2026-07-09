"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import {
  listSyllabi,
  listCourses,
  fetchGraph,
  reprocessGraph,
  type SyllabusUploadAPI,
  type CourseAPI,
  type GraphResponseAPI,
} from "@/lib/api"
import { groupByRealCourse, type RealCourse, type RealCourseGroup } from "@/lib/ui/course-group"
import { Network, Loader2, AlertCircle, BookText, FolderOpen, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MobileNav } from "@/components/navigator/mobile-nav"
import { SelectionAsk } from "@/components/SelectionAsk"
import { useAskInChat } from "@/hooks/use-ask-in-chat"
import GraphCanvas from "@/components/GraphCanvas"

function isReady(d: SyllabusUploadAPI): boolean {
  return d.status === "processed"
}

const folderKey = (g: RealCourseGroup) => g.id ?? "__none__"
const cleanName = (f: string) => f.replace(/\.(pdf|docx|pptx|xlsx)$/i, "")

function MapaContent() {
  const { status, ready } = useUser()
  const { openAuthModal } = useAuthModal()
  const params = useSearchParams()

  // Highlight-to-ask sends selected mind-map text to the chat, bound to this course.
  const askInChat = useAskInChat("el mapa mental del curso")

  const [uploads, setUploads] = useState<SyllabusUploadAPI[]>([])
  const [courses, setCourses] = useState<CourseAPI[]>([])
  const [coursesLoading, setCoursesLoading] = useState(true)

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)

  const [graph, setGraph] = useState<GraphResponseAPI | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Group uploads into real course folders; keep only folders with ≥1 ready doc.
  const realCourses = useMemo<RealCourse[]>(
    () => courses.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    [courses],
  )
  const groups = useMemo<RealCourseGroup[]>(
    () => groupByRealCourse(uploads, realCourses).filter((g) => g.docs.some(isReady)),
    [uploads, realCourses],
  )
  const selectedGroup = useMemo(
    () => groups.find((g) => folderKey(g) === selectedKey) ?? null,
    [groups, selectedKey],
  )
  const readyDocs = useMemo(
    () => (selectedGroup ? selectedGroup.docs.filter(isReady) : []),
    [selectedGroup],
  )

  const ask = useCallback(
    (text: string) =>
      askInChat(
        text,
        selectedGroup
          ? {
              courseId: selectedGroup.id,
              syllabusId: selectedGroup.id ? null : selectedDocId,
            }
          : undefined,
      ),
    [askInChat, selectedGroup, selectedDocId],
  )

  // Load the user's uploads + course folders.
  useEffect(() => {
    if (!ready) return
    if (status === "anonymous" || status === "guest") {
      setCoursesLoading(false)
      return
    }
    let alive = true
    Promise.all([listSyllabi(), listCourses().catch(() => ({ courses: [] as CourseAPI[] }))])
      .then(([u, c]) => {
        if (!alive) return
        setUploads(u.uploads)
        setCourses(c.courses)
      })
      .catch(() => alive && setError("No se pudieron cargar los cursos."))
      .finally(() => alive && setCoursesLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, status])

  // Pick the initial course folder + doc once groups are available, honoring
  // ?course=<docId|courseId> (the deep link from /estudio's "Mapa mental" button).
  useEffect(() => {
    if (selectedKey !== null || groups.length === 0) return
    const wanted = params.get("course")
    const byDoc = groups.find((g) => g.docs.some((d) => d.id === wanted && isReady(d)))
    const byCourse = groups.find((g) => g.id === wanted)
    const pick = byDoc ?? byCourse ?? groups[0]
    setSelectedKey(folderKey(pick))
    const wantedDoc = pick.docs.find((d) => d.id === wanted && isReady(d))
    setSelectedDocId(wantedDoc?.id ?? pick.docs.filter(isReady)[0]?.id ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups])

  // Keep the selected doc valid whenever the course folder changes.
  useEffect(() => {
    if (!selectedGroup) return
    if (!selectedDocId || !readyDocs.some((d) => d.id === selectedDocId)) {
      setSelectedDocId(readyDocs[0]?.id ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey])

  // Load the graph whenever the selected doc changes. Monotonic guard so a slow
  // earlier fetch can't overwrite a newer selection.
  const loadSeq = useRef(0)
  const loadGraph = useCallback(async (docId: string) => {
    const seq = ++loadSeq.current
    setGraphLoading(true)
    setError(null)
    setGraph(null)
    try {
      const g = await fetchGraph(docId)
      if (seq === loadSeq.current) setGraph(g)
    } catch (e) {
      if (seq === loadSeq.current) {
        setError(e instanceof Error ? e.message : "No se pudo cargar el mapa mental.")
      }
    } finally {
      if (seq === loadSeq.current) setGraphLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedDocId) loadGraph(selectedDocId)
  }, [selectedDocId, loadGraph])

  // Reprocess: re-enqueue generation, then poll until the graph settles.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stopPoll = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
  }
  useEffect(() => stopPoll, [])

  const handleReprocess = useCallback(async () => {
    if (!selectedDocId) return
    try {
      const pending = await reprocessGraph(selectedDocId)
      setGraph(pending)
      stopPoll()
      pollRef.current = setInterval(async () => {
        try {
          const g = await fetchGraph(selectedDocId)
          if (g.graph_status !== "pending" && g.graph_status !== "processing") {
            setGraph(g)
            stopPoll()
          }
        } catch {
          stopPoll()
        }
      }, 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo reprocesar el mapa.")
    }
  }, [selectedDocId])

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
          ) : groups.length === 0 ? (
            <Empty />
          ) : (
            <>
              {/* course folder selector */}
              <div className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                <FolderOpen className="h-3.5 w-3.5 text-accent" /> Curso
              </div>
              <div className="mb-4 flex flex-wrap gap-2.5">
                {groups.map((g) => {
                  const active = folderKey(g) === selectedKey
                  const count = g.docs.filter(isReady).length
                  return (
                    <Button
                      key={folderKey(g)}
                      variant={active ? "secondary" : "outline"}
                      onClick={() => setSelectedKey(folderKey(g))}
                      className={
                        active
                          ? "gap-2 border-accent/40 bg-accent/10 text-foreground"
                          : "gap-2 text-muted-foreground"
                      }
                    >
                      <BookText
                        className="h-4 w-4 text-accent"
                        style={g.color ? { color: g.color } : undefined}
                      />
                      {g.name}
                      <span className="rounded-full bg-secondary px-1.5 text-[10px] tabular-nums text-muted-foreground">
                        {count}
                      </span>
                    </Button>
                  )
                })}
              </div>

              {/* doc selector — only when the course has more than one ready PDF */}
              {readyDocs.length > 1 && (
                <>
                  <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                    <FileText className="h-3.5 w-3.5 text-accent" /> Documento
                  </div>
                  <div className="mb-4 flex flex-wrap gap-2">
                    {readyDocs.map((d) => {
                      const active = d.id === selectedDocId
                      return (
                        <button
                          key={d.id}
                          onClick={() => setSelectedDocId(d.id)}
                          className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                            active
                              ? "border-accent/40 bg-accent/10 text-foreground"
                              : "border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {cleanName(d.original_filename)}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}

              <div className="mt-2">
                {graphLoading ? (
                  <CenterSpinner label="Cargando mapa mental…" />
                ) : error ? (
                  <ErrorBox
                    message={error}
                    onRetry={() => selectedDocId && loadGraph(selectedDocId)}
                  />
                ) : graph && selectedGroup ? (
                  <SelectionAsk onAsk={ask}>
                    <GraphCanvas
                      nodes={graph.nodes}
                      edges={graph.edges}
                      crossLinks={graph.crossLinks}
                      layout={graph.layout}
                      graphStatus={graph.graph_status}
                      graphError={graph.graph_error}
                      centerTitle={
                        selectedGroup.id
                          ? selectedGroup.name
                          : selectedDocId
                            ? cleanName(
                                readyDocs.find((d) => d.id === selectedDocId)?.original_filename ??
                                  selectedGroup.name,
                              )
                            : selectedGroup.name
                      }
                      onReprocess={handleReprocess}
                      editable
                      syllabusId={selectedDocId ?? undefined}
                      onSaved={(g) => setGraph(g)}
                    />
                  </SelectionAsk>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
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
