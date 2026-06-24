"use client"

/**
 * CourseSuggestions — pending course-inference panel for /knowledge.
 *
 * Surfaces documents the worker auto-classified (infer_status='suggested') and
 * lets the user act before a course_id is ever assigned: confirm the guess,
 * pick a different existing course, create a new one, reject, or defer.
 * Backed by /api/upload/[id]/course (see setDocumentCourse).
 */

import { useEffect, useState } from "react"
import { listCourses, setDocumentCourse, type SyllabusUploadAPI, type CourseAPI } from "@/lib/api"
import { toast } from "sonner"
import { Sparkles, Check, X, Clock, FolderPlus, Loader2, ChevronDown, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"

/** Confidence → badge tone + label. */
function confidenceBadge(conf: number | null | undefined) {
  const pct = Math.round((conf ?? 0) * 100)
  if (pct >= 70) return { variant: "ok" as const, label: `${pct}% confianza` }
  if (pct >= 40) return { variant: "warn" as const, label: `${pct}% confianza` }
  return { variant: "outline" as const, label: `${pct}% confianza` }
}

export default function CourseSuggestions({
  uploads,
  onChanged,
}: {
  uploads: SyllabusUploadAPI[]
  onChanged: () => Promise<void> | void
}) {
  const suggested = uploads.filter(
    (u) => u.infer_status === "suggested" && !(u as { _optimistic?: boolean })._optimistic,
  )

  const [courses, setCourses] = useState<CourseAPI[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  // "Create new course" dialog state, scoped to one document.
  const [createFor, setCreateFor] = useState<SyllabusUploadAPI | null>(null)
  const [newName, setNewName] = useState("")
  const [creating, setCreating] = useState(false)

  // Load the user's courses once there's at least one suggestion to act on.
  useEffect(() => {
    if (suggested.length === 0) return
    listCourses()
      .then((d) => setCourses(d.courses))
      .catch(() => {})
  }, [suggested.length])

  if (suggested.length === 0) return null

  async function act(
    docId: string,
    body: Parameters<typeof setDocumentCourse>[1],
    successMsg: string,
  ) {
    setBusyId(docId)
    try {
      await setDocumentCourse(docId, body)
      toast.success(successMsg)
      await onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo actualizar el curso.")
    } finally {
      setBusyId(null)
    }
  }

  async function submitNewCourse() {
    if (!createFor) return
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      await setDocumentCourse(createFor.id, { action: "confirm", new_course_name: name })
      toast.success(`Curso "${name}" creado y asignado.`)
      setCreateFor(null)
      setNewName("")
      await onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo crear el curso.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-accent/30 bg-accent/[0.04] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold text-foreground">
          Sugerencias de curso
          <span className="ml-1.5 font-normal text-muted-foreground">({suggested.length})</span>
        </h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Detectamos a qué curso podría pertenecer cada documento. Confirma, elige otro o créalo.
      </p>

      <ul className="flex flex-col gap-2">
        {suggested.map((doc) => {
          const cb = confidenceBadge(doc.infer_confidence)
          const busy = busyId === doc.id
          const others = courses
          return (
            <li
              key={doc.id}
              className="flex flex-col gap-2.5 rounded-lg border border-border/60 bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-accent/70" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={doc.original_filename}>
                    {doc.original_filename}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Sugerido:</span>
                    <Badge variant="accent" className="max-w-[16rem] truncate">
                      {doc.inferred_course ?? "Curso"}
                    </Badge>
                    <Badge variant={cb.variant}>{cb.label}</Badge>
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  variant="accent"
                  disabled={busy}
                  onClick={() => act(doc.id, { action: "confirm" }, "Curso confirmado.")}
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Confirmar
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="secondary" disabled={busy}>
                      Elegir curso
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuLabel>Asignar a…</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {others.length === 0 ? (
                      <DropdownMenuItem disabled>Aún no tienes cursos</DropdownMenuItem>
                    ) : (
                      others.map((c) => (
                        <DropdownMenuItem
                          key={c.id}
                          onClick={() =>
                            act(
                              doc.id,
                              { action: "confirm", course_id: c.id },
                              `Asignado a ${c.name}.`,
                            )
                          }
                        >
                          <span className="truncate">{c.name}</span>
                          <span className="ml-auto text-xs text-muted-foreground">
                            {c.document_count}
                          </span>
                        </DropdownMenuItem>
                      ))
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => {
                        setCreateFor(doc)
                        setNewName(doc.inferred_course ?? "")
                      }}
                    >
                      <FolderPlus className="h-3.5 w-3.5" />
                      Crear curso nuevo…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy}
                  title="Más tarde"
                  onClick={() => act(doc.id, { action: "skip" }, "Lo decides más tarde.")}
                  className="text-muted-foreground"
                >
                  <Clock className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy}
                  title="Descartar sugerencia"
                  onClick={() => act(doc.id, { action: "reject" }, "Sugerencia descartada.")}
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          )
        })}
      </ul>

      {/* Create-new-course dialog (prefilled with the inferred name). */}
      <Dialog open={!!createFor} onOpenChange={(open) => !creating && !open && setCreateFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Crear curso nuevo</DialogTitle>
            <DialogDescription>
              Se creará el curso y se asignará «{createFor?.original_filename}».
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={newName}
            placeholder="Nombre del curso"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitNewCourse()}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateFor(null)} disabled={creating}>
              Cancelar
            </Button>
            <Button
              variant="accent"
              onClick={submitNewCourse}
              disabled={creating || !newName.trim()}
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FolderPlus className="h-4 w-4" />
              )}
              Crear y asignar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
