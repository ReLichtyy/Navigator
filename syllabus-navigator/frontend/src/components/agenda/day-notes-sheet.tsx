"use client"

import { useEffect, useState } from "react"
import { Loader2, Plus, Pencil, Trash2, Check, X, StickyNote, Lock } from "lucide-react"
import { toast } from "sonner"
import {
  listNotes,
  createNote,
  updateNote,
  deleteNote,
  type DateNoteAPI,
  type ScheduleEventAPI,
} from "@/lib/api"
import { meta } from "@/lib/ui/agenda-format"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

/** Pretty Spanish date from an ISO yyyy-mm-dd. */
function prettyDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${+m[3]} de ${MONTHS[+m[2] - 1]} de ${m[1]}`
}

interface Props {
  /** ISO yyyy-mm-dd of the open day, or null when closed. */
  date: string | null
  /** Schedule events that fall on this day (read-only context). */
  dayEvents: ScheduleEventAPI[]
  /** Only registered users can read/write notes. */
  canEdit: boolean
  onClose: () => void
}

export function DayNotesSheet({ date, dayEvents, canEdit, onClose }: Props) {
  const [notes, setNotes] = useState<DateNoteAPI[]>([])
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState("")
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [savingId, setSavingId] = useState<string | null>(null)

  // Load the day's notes whenever a new day opens.
  useEffect(() => {
    if (!date || !canEdit) {
      setNotes([])
      return
    }
    let alive = true
    setLoading(true)
    setDraft("")
    setEditingId(null)
    listNotes(date)
      .then((d) => alive && setNotes(d.notes))
      .catch(() => alive && toast.error("No se pudieron cargar las notas."))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [date, canEdit])

  const handleCreate = async () => {
    const body = draft.trim()
    if (!body || !date) return
    setCreating(true)
    try {
      const { note } = await createNote(date, body)
      setNotes((prev) => [...prev, note])
      setDraft("")
    } catch {
      toast.error("No se pudo crear la nota.")
    } finally {
      setCreating(false)
    }
  }

  const startEdit = (n: DateNoteAPI) => {
    setEditingId(n.id)
    setEditValue(n.body)
  }

  const commitEdit = async (id: string) => {
    const body = editValue.trim()
    if (!body) return
    setSavingId(id)
    try {
      const { note } = await updateNote(id, body)
      setNotes((prev) => prev.map((n) => (n.id === id ? note : n)))
      setEditingId(null)
    } catch {
      toast.error("No se pudo guardar la nota.")
    } finally {
      setSavingId(null)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("¿Borrar esta nota?")) return
    const prev = notes
    setNotes((cur) => cur.filter((n) => n.id !== id))
    try {
      await deleteNote(id)
    } catch {
      toast.error("No se pudo borrar la nota.")
      setNotes(prev)
    }
  }

  return (
    <Sheet open={!!date} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b border-border/60">
          <SheetTitle className="capitalize">{date ? prettyDate(date) : ""}</SheetTitle>
          <SheetDescription>
            {dayEvents.length > 0
              ? `${dayEvents.length} evento${dayEvents.length === 1 ? "" : "s"} · tus notas del día`
              : "Tus notas del día"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
          {/* Day events (read-only) */}
          {dayEvents.length > 0 && (
            <section>
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                Eventos del cronograma
              </h3>
              <ul className="flex flex-col gap-2">
                {dayEvents.map((e) => {
                  const m = meta(e.event_type)
                  return (
                    <li key={e.id} className="flex items-center gap-2.5 rounded-lg border border-border/50 bg-card px-3 py-2">
                      <Badge variant={m.variant} className="shrink-0">
                        <m.Icon className="h-3 w-3" />
                        {m.label}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate text-sm">{e.title}</span>
                      <span className="shrink-0 truncate text-[11px] text-muted-foreground">{e.course_name}</span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {/* Notes */}
          <section className="flex min-h-0 flex-1 flex-col">
            <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              <StickyNote className="h-3.5 w-3.5" />
              Notas
            </h3>

            {!canEdit ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border/60 bg-card p-6 text-center text-muted-foreground">
                <Lock className="h-7 w-7 opacity-30" />
                <p className="text-sm">Inicia sesión con una cuenta para escribir notas en tus fechas.</p>
              </div>
            ) : loading ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {notes.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-sm text-muted-foreground">
                    Aún no hay notas para este día.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {notes.map((n) => (
                      <li key={n.id} className="group rounded-lg border border-border/60 bg-card p-3">
                        {editingId === n.id ? (
                          <div className="flex flex-col gap-2">
                            <Textarea
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="min-h-16 text-sm"
                            />
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                                <X className="h-3.5 w-3.5" /> Cancelar
                              </Button>
                              <Button
                                size="sm"
                                variant="accent"
                                onClick={() => commitEdit(n.id)}
                                disabled={savingId === n.id || !editValue.trim()}
                              >
                                {savingId === n.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                Guardar
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-2">
                            <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-foreground">{n.body}</p>
                            <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                              <Button size="icon-sm" variant="ghost" onClick={() => startEdit(n)} title="Editar">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => handleDelete(n.id)}
                                title="Borrar"
                                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {/* New note composer */}
                <div className="mt-3 flex flex-col gap-2">
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Escribe una nota para este día…"
                    className="min-h-16 text-sm"
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleCreate()
                    }}
                  />
                  <Button
                    variant="accent"
                    onClick={handleCreate}
                    disabled={creating || !draft.trim()}
                    className="self-end"
                  >
                    {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Añadir nota
                  </Button>
                </div>
              </>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}
