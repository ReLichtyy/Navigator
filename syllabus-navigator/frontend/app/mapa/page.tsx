"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import {
  listSyllabi,
  listCourses,
  fetchStudySet,
  fetchCourseStudySet,
  type SyllabusUploadAPI,
  type CourseAPI,
} from "@/lib/api"
import { groupByRealCourse, type RealCourse, type RealCourseGroup } from "@/lib/ui/course-group"
import { fuseMindmaps, type NamedMindmap } from "@/lib/ui/combine-study"
import { Network, Loader2, AlertCircle, Layers, BookText, FolderOpen, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MobileNav } from "@/components/navigator/mobile-nav"
import { SelectionAsk } from "@/components/SelectionAsk"
import { useAskInChat } from "@/hooks/use-ask-in-chat"
import { MindMapCanvas, type Mindmap } from "@/components/estudio/mind-map-canvas"
import { CrossCourseView } from "@/components/estudio/cross-course-view"

function isReady(d: SyllabusUploadAPI): boolean {
  return d.status === "processed"
}

// Stable key for a course folder (the "Sin curso" bucket has a null id).
const folderKey = (g: RealCourseGroup) => g.id ?? "__none__"

function MapaContent() {
  const { status, ready } = useUser()
  const { openAuthModal } = useAuthModal()
  const params = useSearchParams()

  // Send selected/double-clicked mind-map text to the chat.
  const askInChat = useAskInChat("el mapa mental del curso")

  const [view, setView] = useState<"single" | "cross">("single")
  const [uploads, setUploads] = useState<SyllabusUploadAPI[]>([])
  const [courses, setCourses] = useState<CourseAPI[]>([])
  const [coursesLoading, setCoursesLoading] = useState(true)

  // Multi-select of course folders. The fused map combines every selected folder.
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [selectorsOpen, setSelectorsOpen] = useState(true)

  const [mindmap, setMindmap] = useState<Mindmap | null>(null)
  const [setLoading, setSetLoading] = useState(false)
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
  const selectedGroups = useMemo(
    () => groups.filter((g) => selectedKeys.includes(folderKey(g))),
    [groups, selectedKeys],
  )
  const combining = selectedGroups.length > 1

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

  // Pick an initial folder once groups are available (honoring ?course=<docId|courseId>).
  useEffect(() => {
    if (selectedKeys.length > 0 || groups.length === 0) return
    const wanted = params.get("course")
    const byDoc = groups.find((g) => g.docs.some((d) => d.id === wanted))
    const byCourse = groups.find((g) => g.id === wanted)
    const pick = byDoc ?? byCourse ?? groups[0]
    if (pick) setSelectedKeys([folderKey(pick)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups])

  // Resolve a folder's mind map: whole-course set when it's a real course,
  // else the first ready PDF's set (the "Sin curso" bucket). `topic` focuses the
  // regenerated map on specific branches (single-course only).
  const loadFolder = useCallback(
    async (
      g: RealCourseGroup,
      opts: { refresh?: boolean; topic?: string } = {},
    ): Promise<NamedMindmap> => {
      const readyDocs = g.docs.filter(isReady)
      const set = g.id
        ? await fetchCourseStudySet(g.id, opts)
        : await fetchStudySet(readyDocs[0].id, opts)
      return { name: g.name, mindmap: set.mindmap }
    },
    [],
  )

  // Monotonic guard: only the latest load is allowed to write state, so rapid
  // selection toggles can't let a slow earlier fetch overwrite a newer one.
  const loadSeq = useRef(0)

  // (Re)load + fuse the maps of every selected folder.
  const loadSelected = useCallback(
    async (gs: RealCourseGroup[], opts: { refresh?: boolean; topic?: string } = {}) => {
      const seq = ++loadSeq.current
      if (gs.length === 0) {
        setMindmap(null)
        return
      }
      if (opts.refresh) setRegenerating(true)
      else {
        setSetLoading(true)
        setMindmap(null)
      }
      setError(null)
      try {
        // `topic` only applies to a single course; fusing several drops it.
        const perFolder = gs.length === 1 ? opts : { refresh: opts.refresh }
        const named = await Promise.all(gs.map((g) => loadFolder(g, perFolder)))
        if (seq !== loadSeq.current) return
        setMindmap(fuseMindmaps(named))
      } catch (e) {
        if (seq !== loadSeq.current) return
        setError(e instanceof Error ? e.message : "No se pudo cargar el mapa mental.")
      } finally {
        if (seq === loadSeq.current) {
          setSetLoading(false)
          setRegenerating(false)
        }
      }
    },
    [loadFolder],
  )

  // Reload whenever the selection changes (keyed on the sorted folder keys).
  const selKey = selectedGroups.map(folderKey).sort().join("|")
  useEffect(() => {
    if (selectedGroups.length > 0) loadSelected(selectedGroups)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, loadSelected])

  // Toggle a folder in/out of the selection; never let it become empty.
  const toggleFolder = (g: RealCourseGroup) => {
    const k = folderKey(g)
    setSelectedKeys((prev) =>
      prev.includes(k) ? (prev.length > 1 ? prev.filter((x) => x !== k) : prev) : [...prev, k],
    )
  }

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

  const combinedName =
    selectedGroups.length === 1
      ? selectedGroups[0].name
      : `${selectedGroups.length} cursos combinados`

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
              {/* view toggle: combined single/multi course vs cross-course galaxy */}
              <div className="mb-4 inline-flex gap-1 rounded-xl border border-border bg-card/50 p-1">
                <ViewTab
                  active={view === "single"}
                  onClick={() => setView("single")}
                  icon={<Network className="h-3.5 w-3.5" />}
                  label="Mapa de cursos"
                />
                <ViewTab
                  active={view === "cross"}
                  onClick={() => setView("cross")}
                  icon={<Layers className="h-3.5 w-3.5" />}
                  label="Galaxia entre cursos"
                />
              </div>

              {view === "cross" ? (
                <SelectionAsk onAsk={askInChat}>
                  <CrossCourseView />
                </SelectionAsk>
              ) : (
                <>
                  {/* ── Collapsible multi-select of course folders ── */}
                  <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/30">
                    <button
                      onClick={() => setSelectorsOpen((o) => !o)}
                      className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-secondary/40"
                    >
                      <FolderOpen className="h-4 w-4 flex-none text-accent" />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                        {combinedName}
                      </span>
                      <span className="flex-none text-[11px] tabular-nums text-muted-foreground">
                        {selectedGroups.length} de {groups.length}{" "}
                        {groups.length === 1 ? "curso" : "cursos"}
                      </span>
                      <ChevronDown
                        className="h-4 w-4 flex-none text-muted-foreground transition-transform"
                        style={{ transform: selectorsOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                      />
                    </button>

                    {selectorsOpen && (
                      <div className="border-t border-border/50 p-4">
                        <div className="mb-2.5 text-[11px] font-medium text-muted-foreground">
                          Selecciona uno o varios cursos para combinar su mapa mental.
                        </div>
                        <div className="flex flex-wrap gap-2.5">
                          {groups.map((g) => {
                            const active = selectedKeys.includes(folderKey(g))
                            const count = g.docs.filter(isReady).length
                            return (
                              <Button
                                key={folderKey(g)}
                                variant={active ? "secondary" : "outline"}
                                onClick={() => toggleFolder(g)}
                                className={
                                  active
                                    ? "gap-2 border-accent/40 bg-accent/10 text-foreground"
                                    : "gap-2 text-muted-foreground"
                                }
                              >
                                <span
                                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                    active ? "border-accent bg-accent/20" : "border-border"
                                  }`}
                                >
                                  {active && <span className="h-2 w-2 rounded-sm bg-accent" />}
                                </span>
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
                      </div>
                    )}
                  </div>

                  <div className="mt-4">
                    {setLoading ? (
                      <CenterSpinner label="Cargando mapa mental…" />
                    ) : error ? (
                      <ErrorBox message={error} onRetry={() => loadSelected(selectedGroups)} />
                    ) : mindmap ? (
                      <SelectionAsk onAsk={askInChat}>
                        <MindMapCanvas
                          mindmap={mindmap}
                          courseName={combinedName}
                          loading={regenerating}
                          onTopicDouble={askInChat}
                          // Regenerating from the AI panel only makes sense for a
                          // single course; the combined view is read-only. Honor
                          // the focus topics chosen in the edit drawer.
                          onRegenerate={
                            combining
                              ? undefined
                              : ({ focus }) =>
                                  loadSelected(selectedGroups, {
                                    refresh: true,
                                    topic: focus[0],
                                  })
                          }
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
