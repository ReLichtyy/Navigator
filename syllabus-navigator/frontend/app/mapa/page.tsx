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
  fetchCourseGraph,
  regenerateCourseGraph,
  type SyllabusUploadAPI,
  type CourseAPI,
  type GraphResponseAPI,
  type CourseGraphResponseAPI,
  type CourseGraphRegeneratePayload,
} from "@/lib/api"
import { groupByRealCourse, type RealCourse, type RealCourseGroup } from "@/lib/ui/course-group"
import {
  readMindMapSelection,
  clearMindMapSelection,
  type MindMapSelection,
} from "@/lib/ui/mind-map-selection"
import { Network, Loader2, AlertCircle, FileText, Check, Sparkles, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MobileNav } from "@/components/navigator/mobile-nav"
import { SelectionAsk } from "@/components/SelectionAsk"
import { useAskInChat } from "@/hooks/use-ask-in-chat"
import {
  GenerationProgress,
  useGenerationProgress,
} from "@/components/estudio/generation-progress"
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

  // Pending handoff from /estudio (course + PDFs + focus). While present, the
  // page opens on a PREVIEW of what will be processed — nothing generates until
  // the student confirms.
  const [pending, setPending] = useState<MindMapSelection | null>(null)
  // Doc ids ticked in the preview; null = not initialized yet (defaults apply).
  const [previewChecked, setPreviewChecked] = useState<string[] | null>(null)
  const [previewDismissed, setPreviewDismissed] = useState(false)
  useEffect(() => {
    setPending(readMindMapSelection())
  }, [])

  // Course-level map (real course folders) / per-doc fallback ("sin curso").
  const [courseGraph, setCourseGraph] = useState<CourseGraphResponseAPI | null>(null)
  const [docGraph, setDocGraph] = useState<GraphResponseAPI | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
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
  const courseId = selectedGroup?.id ?? null
  // "Sin curso" folders have no course entity — fall back to the first doc's map.
  const pendingFallbackId = pending?.docIds.find((id) => readyDocs.some((d) => d.id === id))
  const fallbackDocId = courseId ? null : (pendingFallbackId ?? readyDocs[0]?.id ?? null)

  const ask = useCallback(
    (text: string) =>
      askInChat(
        text,
        selectedGroup
          ? { courseId: selectedGroup.id, syllabusId: selectedGroup.id ? null : fallbackDocId }
          : undefined,
      ),
    [askInChat, selectedGroup, fallbackDocId],
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

  // Pick the initial course folder once groups are available, honoring
  // ?course=<docId|courseId> (the deep link from /estudio's "Mapa mental" button).
  useEffect(() => {
    if (selectedKey !== null || groups.length === 0) return
    const wanted = params.get("course")
    const byDoc = groups.find((g) => g.docs.some((d) => d.id === wanted && isReady(d)))
    const byCourse = groups.find((g) => g.id === wanted)
    setSelectedKey(folderKey(byDoc ?? byCourse ?? groups[0]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups])

  // Regenerate the course map (initial generation or from the AI drawer).
  // Synchronous POST — the canvas shows "Procesando mapa…" while it runs.
  const regenSeq = useRef(0)
  const regenerate = useCallback(async (cid: string, payload: CourseGraphRegeneratePayload) => {
    const seq = ++regenSeq.current
    setRegenerating(true)
    setError(null)
    try {
      const g = await regenerateCourseGraph(cid, payload)
      if (seq === regenSeq.current) setCourseGraph(g)
    } catch (e) {
      if (seq === regenSeq.current) {
        setError(e instanceof Error ? e.message : "No se pudo generar el mapa del curso.")
      }
    } finally {
      if (seq === regenSeq.current) setRegenerating(false)
    }
  }, [])

  // Load the map whenever the selected folder changes. Course folders read the
  // course map; "sin curso" folders keep the per-document graph. A first visit
  // (graph_status "none") no longer auto-generates — the preview view below asks
  // the student to confirm what should be processed. Monotonic guard so a slow
  // earlier fetch can't overwrite a newer selection.
  const loadSeq = useRef(0)
  const loadGraph = useCallback(async () => {
    const seq = ++loadSeq.current
    setGraphLoading(true)
    setError(null)
    setCourseGraph(null)
    setDocGraph(null)
    try {
      if (courseId) {
        const g = await fetchCourseGraph(courseId)
        if (seq !== loadSeq.current) return
        setCourseGraph(g)
      } else if (fallbackDocId) {
        const g = await fetchGraph(fallbackDocId)
        if (seq !== loadSeq.current) return
        setDocGraph(g)
      }
    } catch (e) {
      if (seq === loadSeq.current) {
        setError(e instanceof Error ? e.message : "No se pudo cargar el mapa mental.")
      }
    } finally {
      if (seq === loadSeq.current) setGraphLoading(false)
    }
  }, [courseId, fallbackDocId])

  useEffect(() => {
    if (courseId || fallbackDocId) void loadGraph()
  }, [courseId, fallbackDocId, loadGraph])

  // Switching folders resets the preview state (ticks + dismissal) — each
  // folder decides for itself whether it needs the confirm step.
  useEffect(() => {
    setPreviewChecked(null)
    setPreviewDismissed(false)
    setFromPreview(false)
  }, [selectedKey])

  // Per-doc fallback reprocess: re-enqueue generation, then poll until it settles.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stopPoll = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
  }
  useEffect(() => stopPoll, [])
  useEffect(() => {
    // Ignore a regeneration/poll that belonged to the previously selected folder.
    regenSeq.current++
    stopPoll()
  }, [selectedKey])

  // ── % progress after the preview's "Generar" (same ramp as /estudio) ──
  // Active while the confirmed generation runs: course mode = the synchronous
  // regenerate POST; "sin curso" = the per-doc reprocess poll. Only runs for
  // generations triggered FROM the preview — the drawer's regen keeps the
  // canvas overlay so the editing context never disappears.
  const [fromPreview, setFromPreview] = useState(false)
  const docProcessingNow =
    !courseId &&
    (docGraph?.graph_status === "pending" || docGraph?.graph_status === "processing")
  const mapProgress = useGenerationProgress(fromPreview && (regenerating || docProcessingNow))
  // Clear the flag once the progress screen actually showed and finished, so a
  // later drawer regeneration doesn't hijack the full-screen progress view.
  const progressShown = useRef(false)
  useEffect(() => {
    if (mapProgress.visible) {
      progressShown.current = true
    } else if (progressShown.current) {
      progressShown.current = false
      setFromPreview(false)
    }
  }, [mapProgress.visible])

  const handleReprocessDoc = useCallback(async () => {
    if (!fallbackDocId) return
    try {
      const pending = await reprocessGraph(fallbackDocId)
      setDocGraph(pending)
      stopPoll()
      pollRef.current = setInterval(async () => {
        try {
          const g = await fetchGraph(fallbackDocId)
          if (g.graph_status !== "pending" && g.graph_status !== "processing") {
            setDocGraph(g)
            stopPoll()
          }
        } catch {
          stopPoll()
        }
      }, 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo reprocesar el mapa.")
    }
  }, [fallbackDocId])

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

  const isCourseMode = !!courseId

  // ── Preview (initial view) ──
  // The handoff only applies to the folder it was written for.
  const pendingMatches = !!pending && !!selectedGroup && pending.courseId === selectedGroup.id
  // Show the confirm step when a selection arrived from /estudio, or on a first
  // visit to a course whose map was never generated (replaces the old auto-gen).
  // A stored "processing"/"pending" course status with no client regeneration in
  // flight is STALE: generation is a synchronous POST, so it only lives while
  // this page is awaiting it — an abandoned run leaves the row stuck and used to
  // greet every visit with an eternal "Procesando mapa…". Offer the preview.
  const staleCourseStatus =
    isCourseMode &&
    (courseGraph?.graph_status === "none" ||
      courseGraph?.graph_status === "processing" ||
      courseGraph?.graph_status === "pending" ||
      courseGraph?.graph_status === "stale")
  const showPreview =
    !!selectedGroup &&
    !graphLoading &&
    !regenerating &&
    !error &&
    !previewDismissed &&
    readyDocs.length > 0 &&
    (pendingMatches || staleCourseStatus)
  const hasExistingMap = isCourseMode
    ? courseGraph?.graph_status === "ready" || courseGraph?.graph_status === "stale"
    : docGraph?.graph_status === "ready"
  // Ticked docs: the /estudio selection when present, else the docs the last
  // map was built from, else every ready doc.
  const lastSourceIds = (courseGraph?.source_doc_ids ?? []).filter((id) =>
    readyDocs.some((d) => d.id === id),
  )
  const checkedIds =
    previewChecked ??
    (pendingMatches
      ? pending!.docIds.filter((id) => readyDocs.some((d) => d.id === id))
      : lastSourceIds.length > 0
        ? lastSourceIds
        : readyDocs.map((d) => d.id))
  const togglePreviewDoc = (id: string) =>
    setPreviewChecked(
      checkedIds.includes(id) ? checkedIds.filter((x) => x !== id) : [...checkedIds, id],
    )

  // Confirm: consume the selection and generate. "Sin curso" folders have no
  // course map — reprocess the per-doc graph only when it isn't usable yet.
  const confirmGenerate = () => {
    const topic = pendingMatches ? pending!.topic : null
    clearMindMapSelection()
    setPending(null)
    setPreviewDismissed(true)
    if (courseId) {
      setFromPreview(true)
      void regenerate(courseId, {
        fileIds: checkedIds,
        instructions: topic ?? undefined,
      })
    } else if (
      fallbackDocId &&
      docGraph &&
      docGraph.graph_status !== "ready" &&
      docGraph.graph_status !== "pending" &&
      docGraph.graph_status !== "processing"
    ) {
      setFromPreview(true)
      void handleReprocessDoc()
    }
  }
  // Secondary action: drop the pending selection and show the current map.
  const dismissPreview = () => {
    clearMindMapSelection()
    setPending(null)
    setPreviewDismissed(true)
  }

  const graphStatus = isCourseMode
    ? regenerating
      ? "processing"
      : (courseGraph?.graph_status ?? undefined)
    : docGraph?.graph_status
  const nodes = isCourseMode ? courseGraph?.nodes : docGraph?.nodes
  const edges = isCourseMode ? courseGraph?.edges : docGraph?.edges
  const crossLinks = isCourseMode ? courseGraph?.crossLinks : docGraph?.crossLinks
  const layout = isCourseMode ? courseGraph?.layout : docGraph?.layout
  const graphError = isCourseMode ? courseGraph?.graph_error : docGraph?.graph_error
  const hasGraph = isCourseMode ? !!courseGraph : !!docGraph

  // Course folders for the drawer's "Curso del mapa" picker (design v3 moves the
  // course selector off the page and into the canvas' Editar drawer).
  const courseOptions = groups.map((g) => ({
    key: folderKey(g),
    name: g.name,
    color: g.color,
    count: g.docs.filter(isReady).length,
  }))

  return (
    <main className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
      {/* Slim header for mobile nav only — desktop is a full-bleed canvas. */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3 sm:hidden">
        <MobileNav />
        <Network className="h-5 w-5 text-accent" />
        <h1 className="text-base font-semibold">Mapa mental</h1>
      </header>

      <div className="relative flex-1 overflow-hidden">
        {coursesLoading ? (
          <CenterFill>
            <CenterSpinner />
          </CenterFill>
        ) : groups.length === 0 ? (
          <CenterFill>
            <Empty />
          </CenterFill>
        ) : graphLoading ? (
          <CenterFill>
            <CenterSpinner label="Cargando mapa mental…" />
          </CenterFill>
        ) : error ? (
          <CenterFill>
            <ErrorBox
              message={error}
              onRetry={() => {
                if (courseId) {
                  const src =
                    courseGraph && courseGraph.source_doc_ids.length > 0
                      ? courseGraph.source_doc_ids
                      : readyDocs.map((d) => d.id)
                  void regenerate(courseId, { fileIds: src })
                } else {
                  void loadGraph()
                }
              }}
            />
          </CenterFill>
        ) : fromPreview && (regenerating || docProcessingNow || mapProgress.visible) ? (
          <CenterFill>
            <GenerationProgress pct={mapProgress.pct} label="Generando mapa mental…" />
          </CenterFill>
        ) : showPreview && selectedGroup ? (
          <CenterFill>
            <MindMapPreview
              courseName={selectedGroup.name}
              docs={readyDocs.map((d) => ({ id: d.id, name: cleanName(d.original_filename) }))}
              checkedIds={checkedIds}
              onToggle={togglePreviewDoc}
              topic={pendingMatches ? pending!.topic : null}
              hasExisting={hasExistingMap}
              onGenerate={confirmGenerate}
              onDismiss={dismissPreview}
            />
          </CenterFill>
        ) : hasGraph && selectedGroup ? (
          <SelectionAsk onAsk={ask} className="h-full">
            <GraphCanvas
              nodes={nodes}
              edges={edges}
              crossLinks={crossLinks}
              layout={layout}
              graphStatus={graphStatus}
              graphError={graphError}
              centerTitle={
                selectedGroup.id
                  ? selectedGroup.name
                  : fallbackDocId
                    ? cleanName(
                        readyDocs.find((d) => d.id === fallbackDocId)?.original_filename ??
                          selectedGroup.name,
                      )
                    : selectedGroup.name
              }
              editable
              // Course mode: edits + AI regeneration on the course map.
              courseId={courseId ?? undefined}
              courseFiles={
                courseId
                  ? readyDocs.map((d) => ({ id: d.id, name: d.original_filename }))
                  : undefined
              }
              sourceDocIds={courseId ? courseGraph?.source_doc_ids : undefined}
              onRegenerateAI={
                courseId ? (payload) => void regenerate(courseId, payload) : undefined
              }
              // "Sin curso" fallback: per-document map with its reprocess.
              syllabusId={fallbackDocId ?? undefined}
              onReprocess={
                courseId
                  ? () => {
                      const src =
                        courseGraph && courseGraph.source_doc_ids.length > 0
                          ? courseGraph.source_doc_ids
                          : readyDocs.map((d) => d.id)
                      void regenerate(courseId, { fileIds: src })
                    }
                  : handleReprocessDoc
              }
              onSaved={(g) => {
                if ("course_id" in g) setCourseGraph(g)
                else setDocGraph(g)
              }}
              // Course selection now lives in the Editar drawer (design v3).
              courses={courseOptions}
              selectedCourseKey={selectedKey}
              onSelectCourse={setSelectedKey}
            />
          </SelectionAsk>
        ) : null}
      </div>
    </main>
  )
}

/**
 * Initial view of /mapa: preview of what will be processed (course + PDF
 * checklist + optional focus from /estudio). Nothing generates until the
 * student presses the CTA.
 */
function MindMapPreview({
  courseName,
  docs,
  checkedIds,
  onToggle,
  topic,
  hasExisting,
  onGenerate,
  onDismiss,
}: {
  courseName: string
  docs: { id: string; name: string }[]
  checkedIds: string[]
  onToggle: (id: string) => void
  topic: string | null
  hasExisting: boolean
  onGenerate: () => void
  onDismiss: () => void
}) {
  const canGenerate = checkedIds.length > 0
  return (
    <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10">
          <Network className="h-5 w-5 text-accent" />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Vista previa del mapa mental
          </div>
          <div className="truncate text-lg font-extrabold leading-tight">{courseName}</div>
        </div>
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        Este material alimentará el mapa. Marca o desmarca PDFs antes de generarlo.
      </p>

      <ul className="mt-3 flex max-h-64 flex-col gap-1.5 overflow-y-auto">
        {docs.map((d) => {
          const active = checkedIds.includes(d.id)
          return (
            <li key={d.id}>
              <button
                onClick={() => onToggle(d.id)}
                aria-pressed={active}
                className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  active
                    ? "border-accent/40 bg-accent/[0.07]"
                    : "border-border/60 hover:border-accent/30"
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    active ? "border-accent bg-accent" : "border-border"
                  }`}
                >
                  {active && (
                    <Check className="h-3 w-3 text-accent-foreground" strokeWidth={3.2} />
                  )}
                </span>
                <FileText className="h-4 w-4 shrink-0 text-accent/70" />
                <span
                  className={`min-w-0 flex-1 truncate text-sm ${
                    active ? "font-medium text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {d.name}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {topic && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-accent/25 bg-accent/[0.06] px-3 py-2">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="min-w-0 truncate text-xs text-accent" title={topic}>
            Enfoque: {topic}
          </span>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-4">
        <span className="font-mono text-[11px] text-muted-foreground">
          {checkedIds.length}/{docs.length} {docs.length === 1 ? "PDF" : "PDFs"}
        </span>
        <div className="flex items-center gap-2">
          {hasExisting && (
            <Button variant="outline" size="sm" onClick={onDismiss}>
              Ver mapa actual
            </Button>
          )}
          <button
            onClick={onGenerate}
            disabled={!canGenerate}
            className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Generar mapa mental <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

/** Centers a small status block (spinner / empty / error) in the full-bleed area. */
function CenterFill({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center p-4">{children}</div>
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
