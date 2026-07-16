"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import {
  listSyllabi,
  uploadSyllabusViaBlob,
  addLink,
  addTextSource,
  deleteSyllabus,
  fetchGraph,
  reprocessGraph,
  renameDocument,
  listCourses,
  createCourse,
  deleteCourse,
  renameCourse,
  updateCourse,
  setDocumentCourse,
  processDocument,
  findOrCreateChatForDoc,
} from "@/lib/api"
import type { SyllabusUploadAPI, GraphResponseAPI, CourseAPI } from "@/lib/api"
import { useChatNav } from "@/context/ChatNavContext"
import Link from "next/link"
import {
  Search,
  Plus,
  FolderPlus,
  FileText,
  Loader2,
  Library,
  BookText,
  GraduationCap,
  MessageSquare,
  Trash2,
  Eye,
  Pencil,
  Check,
  RefreshCw,
  AlertTriangle,
  X,
  FolderInput,
  Network as NetworkIcon,
  FileText as FileIcon,
  Link2,
  Type,
  GripVertical,
  CalendarDays,
  Palette,
} from "lucide-react"
import { toast } from "sonner"
import GraphCanvas from "@/components/GraphCanvas"
import CourseSuggestions from "@/components/CourseSuggestions"
import { CourseColorPicker } from "@/components/courses/course-color-picker"
import {
  COURSE_COLORS,
  randomCourseColor,
  resolveCourseColor,
  colorTint,
} from "@/lib/ui/course-color"
import { MobileNav } from "@/components/navigator/mobile-nav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { getDocStatus, isChatReady, NEEDS_OCR_HINT } from "@/lib/ui/doc-status"
import { groupByRealCourse, type RealCourse } from "@/lib/ui/course-group"
import { TopicsArchive } from "@/components/knowledge/topics-archive"
import { AgendaPanel } from "@/components/knowledge/agenda-panel"

/** Row icon by source kind: web link, pasted text, or an uploaded file. */
function docRowIcon(sourceType?: string) {
  if (sourceType === "link") return Link2
  if (sourceType === "text") return Type
  return FileText
}

/**
 * Muted inline descriptor shown next to the document name: the domain for web
 * links (the name is the page title, so the origin matters), "texto pegado"
 * for pasted text. Files need none — their name already carries the extension.
 */
function docDescriptor(doc: SyllabusUploadAPI): string | null {
  if (doc.source_type === "link" && doc.source_url) {
    try {
      return new URL(doc.source_url).hostname.replace(/^www\./, "")
    } catch {
      return doc.source_url
    }
  }
  if (doc.source_type === "text") return "texto pegado"
  return null
}

export default function KnowledgeBasePage() {
  const { status, ready } = useUser()
  const { openAuthModal } = useAuthModal()
  const nav = useChatNav()
  // In-app confirmation dialog (replaces the browser's native confirm()).
  const { confirm, confirmDialog } = useConfirm()

  const [uploads, setUploads] = useState<SyllabusUploadAPI[]>([])
  const [courses, setCourses] = useState<CourseAPI[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [isUploading, setIsUploading] = useState(false)

  // Create-course dialog. The color starts random (re-rolled every time the
  // dialog opens, avoiding hues already taken) but the user can override it.
  const [createCourseOpen, setCreateCourseOpen] = useState(false)
  const [newCourseName, setNewCourseName] = useState("")
  const [newCourseColor, setNewCourseColor] = useState<string>(COURSE_COLORS[0].hex)
  const [creatingCourse, setCreatingCourse] = useState(false)
  const [previewDoc, setPreviewDoc] = useState<{
    id: string
    name: string
    fileUrl: string | null
    sourceType?: string
    sourceUrl?: string | null
  } | null>(null)
  const [previewMode, setPreviewMode] = useState<"pdf" | "graph">("pdf")
  const [previewGraph, setPreviewGraph] = useState<GraphResponseAPI | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  // Rename state: { [docId]: draftName }
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [renameExt, setRenameExt] = useState("")
  const [fileDragActive, setFileDragActive] = useState(false)
  const [isSavingRename, setIsSavingRename] = useState(false)

  // Course (folder) rename state — independent of the document rename above.
  const [renamingCourseId, setRenamingCourseId] = useState<string | null>(null)
  const [courseRenameValue, setCourseRenameValue] = useState("")
  const [savingCourseRename, setSavingCourseRename] = useState(false)

  // Color editor — per course folder. The color is what the Agenda calendar paints with.
  const [editingColorCourseId, setEditingColorCourseId] = useState<string | null>(null)
  const [savingColor, setSavingColor] = useState(false)

  // Term-start editor ("Semana N" → real dates) — per course folder.
  const [editingTermCourseId, setEditingTermCourseId] = useState<string | null>(null)
  const [termValue, setTermValue] = useState("")
  const [savingTerm, setSavingTerm] = useState(false)

  // Drag & drop: the document being dragged, and the folder currently hovered.
  const [draggingDoc, setDraggingDoc] = useState<SyllabusUploadAPI | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)

  // Add-source dialog (PDF / link / text)
  const [addOpen, setAddOpen] = useState(false)
  const [addTab, setAddTab] = useState<"pdf" | "link" | "text">("pdf")
  const [linkUrl, setLinkUrl] = useState("")
  const [textTitle, setTextTitle] = useState("")
  const [textBody, setTextBody] = useState("")
  const [isAdding, setIsAdding] = useState(false)
  // When set, sources added via the dialog go straight into this course (no
  // inference/suggestion step). null = header button → unassigned.
  const [addCourseId, setAddCourseId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  // BUG FIX #4: Use ref for interval to prevent stale closure race condition
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isMountedRef = useRef(true)
  const router = useRouter()

  const clearPolling = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  const fetchUploads = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const [data, courseData] = await Promise.all([
        listSyllabi(),
        listCourses().catch(() => ({ courses: [] as CourseAPI[] })),
      ])
      if (!isMountedRef.current) return

      setCourses(courseData.courses)

      // Filter out any optimistic "uploading" rows before merging
      setUploads((prev) => {
        const optimistic = prev.filter((u) => (u as any)._optimistic)
        const merged = [...data.uploads]
        // Keep optimistic rows for files not yet returned by the server
        for (const op of optimistic) {
          if (!merged.find((u) => u.id === op.id)) merged.unshift(op)
        }
        return merged
      })
      setError(null)

      // BUG FIX #4: Use ref to manage interval, never create more than one
      const needsPolling = data.uploads.some(
        (u) =>
          u.status === "pending" || u.graph_status === "pending" || u.graph_status === "processing",
      )
      if (needsPolling && !intervalRef.current) {
        intervalRef.current = setInterval(() => fetchUploads(true), 3000)
      } else if (!needsPolling && intervalRef.current) {
        clearPolling()
      }
    } catch (err) {
      if (isMountedRef.current && !silent) setError("No se pudieron cargar los documentos.")
    } finally {
      if (isMountedRef.current && !silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    if (!ready) return
    if (status === "anonymous" || status === "guest") {
      setLoading(false)
      return
    }
    fetchUploads()
    return () => {
      isMountedRef.current = false
      clearPolling()
    }
  }, [ready, status, fetchUploads])

  // Stop the browser from navigating to / opening a file when an external file
  // drag is dropped anywhere outside the dropzone (a missed drop). Only guards
  // file drags, so internal document drag-and-drop is untouched.
  useEffect(() => {
    const isFileDrag = (e: DragEvent) =>
      Boolean(e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files"))
    const onDragOver = (e: DragEvent) => {
      if (isFileDrag(e)) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      if (isFileDrag(e)) e.preventDefault()
    }
    window.addEventListener("dragover", onDragOver)
    window.addEventListener("drop", onDrop)
    return () => {
      window.removeEventListener("dragover", onDragOver)
      window.removeEventListener("drop", onDrop)
    }
  }, [])

  const handleUploadClick = () => fileInputRef.current?.click()

  // Assign a freshly-created source to a course, skipping the inference flow.
  // No-op when courseId is null (header upload → stays unassigned).
  const assignToCourse = async (syllabusId: string, courseId: string | null) => {
    if (!courseId) return
    try {
      await setDocumentCourse(syllabusId, { action: "confirm", course_id: courseId })
    } catch {
      toast.error("Subido, pero no se pudo asignar al curso.")
    }
  }

  // Shared upload path for both the file picker and drag-and-drop. Validates
  // each file client-side, shows an optimistic row, uploads sequentially.
  const uploadFiles = async (files: File[], targetCourseId: string | null) => {
    if (files.length === 0) return

    const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB — must match document.service.ts
    const ACCEPTED_EXT = /\.(pdf|docx|pptx|xlsx)$/i

    setIsUploading(true)
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (!ACCEPTED_EXT.test(file.name)) {
        toast.error(`${file.name}: solo PDF, Word, PowerPoint o Excel.`)
        continue
      }
      if (file.size === 0) {
        toast.error(`${file.name} está vacío.`)
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name} supera el límite de 25MB.`)
        continue
      }

      // Duplicate filename check — UX guard (backend handles hash-based dedup).
      const existingNames = new Set(uploads.map((u) => u.original_filename.toLowerCase()))
      if (existingNames.has(file.name.toLowerCase())) {
        const ok = await confirm({
          title: "Documento duplicado",
          description: `"${file.name}" ya existe en tu biblioteca. ¿Subirlo de nuevo?`,
          confirmLabel: "Subir de nuevo",
        })
        if (!ok) continue
      }

      // Optimistic row. Unique id per file (Date.now() alone collides when
      // several files are added within the same millisecond).
      const tempId = `optimistic-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`
      const optimisticRow: SyllabusUploadAPI & { _optimistic?: boolean } = {
        id: tempId,
        original_filename: file.name,
        status: "pending",
        graph_status: "pending",
        created_at: new Date().toISOString(),
        course_id: targetCourseId,
        _optimistic: true,
      }
      setUploads((prev) => [optimisticRow as any, ...prev])

      // Loading toast (mini modal) that stays on screen while this file uploads,
      // then turns into the success/error result (same id replaces it in place).
      const toastId = toast.loading(`Subiendo ${file.name}…`)
      try {
        // Upload straight to Blob (bypasses the ~4.5MB serverless body limit).
        const res = await uploadSyllabusViaBlob(file)
        await assignToCourse(res.syllabus_id, targetCourseId)
        // Fire the slow enrichment (graph/schedule/inference) without blocking;
        // the row is already chat-ready and polling fills in the graph when done.
        processDocument(res.syllabus_id).catch(() => {})
        toast.success(`${file.name} subido correctamente.`, { id: toastId })
      } catch (err: any) {
        toast.error(err?.message ?? `No se pudo subir ${file.name}.`, { id: toastId })
      } finally {
        // Remove the optimistic row
        setUploads((prev) => prev.filter((u) => u.id !== tempId))
      }
    }

    setIsUploading(false)
    await fetchUploads(true)
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    if (fileInputRef.current) fileInputRef.current.value = ""

    // Snapshot the target now; reset so later header uploads stay unassigned.
    const targetCourseId = addCourseId
    setAddCourseId(null)

    await uploadFiles(files, targetCourseId)
  }

  // Drag-and-drop from the OS file explorer onto the "Añadir fuente" dropzone.
  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setFileDragActive(false)

    // Only react to real files dragged from outside (ignore internal doc drags).
    const files = Array.from(e.dataTransfer.files ?? [])
    if (files.length === 0) return

    const targetCourseId = addCourseId
    setAddCourseId(null)
    setAddOpen(false)

    await uploadFiles(files, targetCourseId)
  }

  const handleAddLink = async () => {
    const url = linkUrl.trim()
    if (!url) return
    const targetCourseId = addCourseId
    setIsAdding(true)
    const toastId = toast.loading("Añadiendo enlace…")
    try {
      const res = await addLink(url)
      await assignToCourse(res.syllabus_id, targetCourseId)
      processDocument(res.syllabus_id).catch(() => {})
      toast.success("Enlace añadido.", { id: toastId })
      setLinkUrl("")
      setAddCourseId(null)
      setAddOpen(false)
      await fetchUploads(true)
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo añadir el enlace.", { id: toastId })
    } finally {
      setIsAdding(false)
    }
  }

  const handleAddText = async () => {
    const body = textBody.trim()
    if (!body) return
    const targetCourseId = addCourseId
    setIsAdding(true)
    const toastId = toast.loading("Añadiendo texto…")
    try {
      const res = await addTextSource(body, textTitle.trim() || undefined)
      await assignToCourse(res.syllabus_id, targetCourseId)
      processDocument(res.syllabus_id).catch(() => {})
      toast.success("Texto añadido.", { id: toastId })
      setTextTitle("")
      setTextBody("")
      setAddCourseId(null)
      setAddOpen(false)
      await fetchUploads(true)
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo añadir el texto.", { id: toastId })
    } finally {
      setIsAdding(false)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: `¿Eliminar "${name}"?`,
      description: "Esta acción no se puede deshacer.",
      confirmLabel: "Eliminar",
      destructive: true,
    })
    if (!ok) return
    // Optimistic removal
    setUploads((prev) => prev.filter((u) => u.id !== id))
    try {
      await deleteSyllabus(id)
      toast.success("Documento eliminado.")
    } catch (err) {
      toast.error("No se pudo eliminar el documento.")
      // Revert on failure
      await fetchUploads(true)
    }
  }

  const handleChat = async (id: string, _name: string) => {
    try {
      const chat = await findOrCreateChatForDoc(id)
      nav.requestChat(chat.id)
      router.push("/")
    } catch {
      toast.error("No se pudo abrir el chat para este documento")
    }
  }

  const handlePreview = (doc: SyllabusUploadAPI) => {
    const fileUrl = doc.file_url ?? null
    const sourceType = doc.source_type
    setPreviewDoc({
      id: doc.id,
      name: doc.original_filename,
      fileUrl,
      sourceType,
      sourceUrl: doc.source_url ?? null,
    })
    setPreviewGraph(null)
    // Inline preview only works for PDFs; for other files jump straight to the graph.
    const inlineViewable = Boolean(fileUrl) && (!sourceType || sourceType === "pdf")
    setPreviewMode(inlineViewable ? "pdf" : "graph")
    if (!inlineViewable) loadGraphPreview(doc.id)
  }

  const loadGraphPreview = async (id: string) => {
    setPreviewLoading(true)
    setPreviewGraph(null)
    try {
      setPreviewGraph(await fetchGraph(id))
    } catch {
      toast.error("No se pudo cargar el mapa.")
    } finally {
      setPreviewLoading(false)
    }
  }

  // Switch the preview modal to the graph view, loading it on first open.
  const showGraphPreview = () => {
    setPreviewMode("graph")
    if (previewDoc && !previewGraph && !previewLoading) loadGraphPreview(previewDoc.id)
  }

  // Delete a course folder AND its documents (server cascades; irreversible).
  const handleDeleteCourse = async (courseId: string, name: string, docCount: number) => {
    const ok = await confirm({
      title: `¿Eliminar el curso "${name}"?`,
      description:
        docCount > 0
          ? `Se eliminarán también ${docCount === 1 ? "su documento" : `sus ${docCount} documentos`} con todo su material de estudio. Esta acción no se puede deshacer.`
          : "La carpeta se eliminará. Esta acción no se puede deshacer.",
      confirmLabel: docCount > 0 ? "Eliminar todo" : "Eliminar curso",
      destructive: true,
    })
    if (!ok) return
    // Optimistic: drop the course AND its documents locally.
    setCourses((prev) => prev.filter((c) => c.id !== courseId))
    setUploads((prev) => prev.filter((u) => u.course_id !== courseId))
    try {
      await deleteCourse(courseId)
      toast.success(docCount > 0 ? "Curso y documentos eliminados." : "Curso eliminado.")
    } catch {
      toast.error("No se pudo eliminar el curso.")
      await fetchUploads(true)
    }
  }

  // Move a document to another course (or out of one) via the real course_id FK.
  const handleMove = async (doc: SyllabusUploadAPI, targetCourseId: string | null) => {
    if ((doc.course_id ?? null) === targetCourseId) return
    setUploads((prev) =>
      prev.map((u) => (u.id === doc.id ? { ...u, course_id: targetCourseId } : u)),
    )
    try {
      if (targetCourseId) {
        await setDocumentCourse(doc.id, { action: "confirm", course_id: targetCourseId })
        toast.success("Documento movido.")
      } else {
        await setDocumentCourse(doc.id, { action: "skip" })
        toast.success("Quitado del curso.")
      }
      await fetchUploads(true)
    } catch {
      toast.error("No se pudo mover el documento.")
      await fetchUploads(true)
    }
  }

  // Open the dialog with a fresh random color (skipping colors already in use).
  const openCreateCourse = () => {
    setNewCourseColor(randomCourseColor(courses.map((c) => c.color)))
    setCreateCourseOpen(true)
  }

  const handleCreateCourse = async () => {
    const name = newCourseName.trim()
    if (!name) return
    setCreatingCourse(true)
    try {
      await createCourse({ name, color: newCourseColor })
      toast.success(`Curso "${name}" creado.`)
      setNewCourseName("")
      setCreateCourseOpen(false)
      await fetchUploads(true)
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo crear el curso.")
    } finally {
      setCreatingCourse(false)
    }
  }

  // ----- course color (folder + agenda calendar share it) -----
  const commitCourseColor = async (courseId: string, color: string) => {
    setSavingColor(true)
    // Optimistic: the folder repaints immediately; the agenda picks it up on its next load.
    setCourses((prev) => prev.map((c) => (c.id === courseId ? { ...c, color } : c)))
    try {
      await updateCourse(courseId, { color })
      toast.success("Color actualizado.")
      setEditingColorCourseId(null)
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo guardar el color.")
      await fetchUploads(true)
    } finally {
      setSavingColor(false)
    }
  }

  // ----- course (folder) rename -----
  const startCourseRename = (courseId: string, currentName: string) => {
    setRenamingCourseId(courseId)
    setCourseRenameValue(currentName)
  }
  const commitCourseRename = async (courseId: string) => {
    const name = courseRenameValue.trim()
    if (!name) {
      setRenamingCourseId(null)
      return
    }
    setSavingCourseRename(true)
    // Optimistic rename of the folder.
    setCourses((prev) => prev.map((c) => (c.id === courseId ? { ...c, name } : c)))
    try {
      await renameCourse(courseId, name)
      toast.success("Curso renombrado.")
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo renombrar el curso.")
      await fetchUploads(true)
    } finally {
      setRenamingCourseId(null)
      setSavingCourseRename(false)
    }
  }

  // ----- course term start ("Semana N" → fecha real) -----
  const startTermEdit = (courseId: string) => {
    setEditingTermCourseId(courseId)
    setTermValue(courses.find((c) => c.id === courseId)?.term_start ?? "")
  }
  const commitTermStart = async (courseId: string) => {
    const term = termValue || null
    setSavingTerm(true)
    // Optimistic: the calendar/recommendations re-derive from this on refetch.
    setCourses((prev) => prev.map((c) => (c.id === courseId ? { ...c, term_start: term } : c)))
    try {
      await updateCourse(courseId, { term_start: term })
      toast.success(
        term
          ? "Inicio del semestre guardado. Los eventos 'Semana N' ya tienen fecha."
          : "Inicio del semestre borrado.",
      )
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo guardar la fecha.")
      await fetchUploads(true)
    } finally {
      setEditingTermCourseId(null)
      setSavingTerm(false)
    }
  }

  // ----- drag & drop: move a document between folders, or onto the trash zone -----
  const onDocDragStart = (doc: SyllabusUploadAPI) => (e: React.DragEvent) => {
    setDraggingDoc(doc)
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", doc.id)
  }
  const onDocDragEnd = () => {
    setDraggingDoc(null)
    setDragOverKey(null)
  }
  // Drop a dragged doc onto a folder (courseId, or null for "Sin curso").
  const onFolderDrop = (targetCourseId: string | null) => (e: React.DragEvent) => {
    e.preventDefault()
    setDragOverKey(null)
    const doc = draggingDoc
    setDraggingDoc(null)
    if (doc) handleMove(doc, targetCourseId)
  }
  const onFolderDragOver = (key: string) => (e: React.DragEvent) => {
    if (!draggingDoc) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    if (dragOverKey !== key) setDragOverKey(key)
  }
  const onTrashDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOverKey(null)
    const doc = draggingDoc
    setDraggingDoc(null)
    if (doc) handleDelete(doc.id, doc.original_filename)
  }

  const handleReprocess = async () => {
    if (!previewDoc) return
    try {
      const data = await reprocessGraph(previewDoc.id)
      setPreviewGraph(data)
      toast.success("Reprocesamiento iniciado.")
    } catch {
      toast.error("No se pudo reprocesar el mapa.")
    }
  }

  const [reprocessingId, setReprocessingId] = useState<string | null>(null)

  const handleReprocessRow = async (id: string) => {
    setReprocessingId(id)
    try {
      await reprocessGraph(id)
      toast.success("Reprocesamiento iniciado.")
      await fetchUploads(true)
    } catch {
      toast.error("No se pudo iniciar el reprocesamiento.")
    } finally {
      setReprocessingId(null)
    }
  }

  const startRename = (doc: SyllabusUploadAPI) => {
    setRenamingId(doc.id)
    setRenameValue(doc.original_filename.replace(/\.(pdf|docx|pptx|xlsx)$/i, ""))
    setRenameExt(doc.original_filename.match(/\.(pdf|docx|pptx|xlsx)$/i)?.[0] ?? "")
  }

  const commitRename = async (id: string) => {
    const trimmed = renameValue.trim()
    if (!trimmed) {
      setRenamingId(null)
      return
    }

    // Preserve the source file's real extension (renames keep the format).
    const newName =
      renameExt && trimmed.toLowerCase().endsWith(renameExt.toLowerCase())
        ? trimmed
        : `${trimmed}${renameExt}`
    setIsSavingRename(true)
    try {
      await renameDocument(id, newName)
      setUploads((prev) =>
        prev.map((u) => (u.id === id ? { ...u, original_filename: newName } : u)),
      )
      toast.success("Documento renombrado.")
    } catch {
      toast.error("No se pudo renombrar el documento.")
    } finally {
      setRenamingId(null)
      setIsSavingRename(false)
    }
  }

  if (ready && (status === "anonymous" || status === "guest")) {
    return (
      <main className="flex h-dvh w-full items-center justify-center bg-background text-foreground">
        <div className="flex max-w-md flex-col items-center text-center p-8 border border-border/60 rounded-xl bg-card shadow-sm">
          <Library className="h-12 w-12 text-accent mb-4" />
          <h2 className="text-xl font-semibold mb-2">Knowledge</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Inicia sesión para gestionar tus cursos y documentos, ver tu agenda de evaluaciones y
            tomar notas. Todo potencia a tu asistente de IA.
          </p>
          <button
            onClick={() => openAuthModal("signup")}
            className="rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90"
          >
            Crear cuenta
          </button>
        </div>
      </main>
    )
  }

  const realCourses: RealCourse[] = courses.map((c) => ({ id: c.id, name: c.name, color: c.color }))
  // Search matches BOTH document names and course names (as the placeholder
  // promises): a course-name hit keeps the whole folder with all its documents.
  const q = searchQuery.trim().toLowerCase()
  const matchedCourseIds = new Set(
    q ? realCourses.filter((c) => c.name.toLowerCase().includes(q)).map((c) => c.id) : [],
  )
  const filteredUploads = q
    ? uploads.filter(
        (u) =>
          u.original_filename.toLowerCase().includes(q) ||
          (u.course_id != null && matchedCourseIds.has(u.course_id)),
      )
    : uploads
  // While searching, surface folders whose name matched or that kept a matching doc.
  const visibleCourses = q
    ? realCourses.filter(
        (c) => matchedCourseIds.has(c.id) || filteredUploads.some((u) => u.course_id === c.id),
      )
    : realCourses
  const courseGroups = groupByRealCourse(filteredUploads, visibleCourses)

  // Full upload backing the preview dialog (for status-aware actions).
  const previewUpload = previewDoc ? uploads.find((u) => u.id === previewDoc.id) : undefined
  const previewReady = previewUpload ? isChatReady(previewUpload) : false
  const previewNeedsOcr = previewUpload?.status === "needs_ocr"

  return (
    <main className="flex h-dvh w-full flex-col bg-background text-foreground overflow-hidden">
      <header className="flex h-14 items-center justify-between gap-2 border-b border-border/60 px-3 shrink-0 sm:px-6">
        <h1 className="flex min-w-0 items-center gap-2 text-lg font-semibold">
          <MobileNav />
          <Library className="hidden h-5 w-5 shrink-0 text-accent sm:inline" />
          <span className="truncate">Knowledge</span>
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            onClick={() => {
              setNewCourseName("")
              openCreateCourse()
            }}
            disabled={isUploading}
            variant="outline"
            size="pill"
          >
            <FolderPlus className="h-4 w-4" />
            <span className="hidden sm:inline">Añadir curso</span>
          </Button>
          <Button
            onClick={() => {
              setAddCourseId(null)
              setAddTab("pdf")
              setAddOpen(true)
            }}
            disabled={isUploading}
            variant="accent"
            size="pill"
          >
            {isUploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">{isUploading ? "Subiendo…" : "Añadir fuente"}</span>
          </Button>
        </div>
        <input
          type="file"
          ref={fileInputRef}
          accept=".pdf,.docx,.pptx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          multiple
          onChange={handleFileChange}
        />
      </header>

      <div className="flex-1 overflow-auto overscroll-contain p-4 sm:p-6">
        <div className="mx-auto grid max-w-7xl items-start gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,3fr)]">
          {/* ═══ Left column: Cursos + Archivo de temas ═══ */}
          <div className="min-w-0">
          <p className="mb-5 max-w-2xl text-sm text-muted-foreground">
            Cada curso tiene su propia carpeta de documentos. Los modos de estudio se generan a
            partir de ellos.
          </p>

          <CourseSuggestions uploads={uploads} onChanged={() => fetchUploads(true)} />

          <div className="mb-6 flex items-center justify-between">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
              <Input
                type="text"
                placeholder="Buscar cursos o documentos…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="rounded-full border-border/60 bg-secondary/50 pl-9"
              />
            </div>
          </div>

          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-border/60 bg-card text-center p-6">
              <p className="text-destructive mb-2">{error}</p>
              <Button
                variant="link"
                onClick={() => fetchUploads()}
                className="text-muted-foreground"
              >
                Reintentar
              </Button>
            </div>
          ) : courseGroups.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-border/60 bg-card text-center p-6 text-muted-foreground">
              <FileText className="h-10 w-10 mb-3 opacity-20" />
              <p className="text-sm font-medium mb-1">
                {searchQuery ? "No se encontraron cursos." : "Tu biblioteca está vacía."}
              </p>
              <p className="text-xs">
                {searchQuery
                  ? "Prueba otro término de búsqueda."
                  : "Sube el programa de tu curso (PDF, Word, PowerPoint, un enlace o texto) para empezar."}
              </p>
              {!searchQuery && (
                <Button
                  variant="accent"
                  size="sm"
                  className="mt-4"
                  onClick={() => {
                    setAddCourseId(null)
                    setAddTab("pdf")
                    setAddOpen(true)
                  }}
                >
                  <Plus className="h-4 w-4" /> Añadir fuente
                </Button>
              )}
            </div>
          ) : (
            <Accordion type="multiple" className="flex flex-col gap-3">
              {courseGroups.map((course) => {
                const firstReady = course.docs.find(
                  (d) => d.status === "processed" && !(d as any)._optimistic,
                )
                const groupKey = course.id ?? "sin-curso"
                // Same resolution the Agenda calendar uses, so a folder and its
                // events in the calendar always carry the identical color.
                const folderColor = course.id
                  ? resolveCourseColor(course.color, course.id)
                  : undefined
                // Highlight a folder as a drop target while dragging a doc from elsewhere.
                const isDropTarget =
                  !!draggingDoc &&
                  dragOverKey === groupKey &&
                  (draggingDoc.course_id ?? null) !== (course.id ?? null)
                return (
                  <AccordionItem
                    key={groupKey}
                    value={groupKey}
                    className={`relative transition-colors ${
                      isDropTarget
                        ? "rounded-xl ring-2 ring-accent ring-offset-2 ring-offset-background"
                        : ""
                    }`}
                    onDragOver={onFolderDragOver(groupKey)}
                    onDragLeave={() => dragOverKey === groupKey && setDragOverKey(null)}
                    onDrop={onFolderDrop(course.id ?? null)}
                  >
                    <div className="absolute right-3 top-2.5 z-10 flex items-center gap-1.5">
                      {firstReady && (
                        <Button asChild size="sm" variant="secondary" className="h-8 gap-1.5">
                          {/* Deep-link the COURSE (estudio picks the best scope: last
                              used, else its default). Only the "Sin curso" bucket
                              (no id) falls back to the first ready document. */}
                          <Link href={`/estudio?course=${course.id ?? firstReady.id}`}>
                            <GraduationCap className="h-3.5 w-3.5 text-accent" />
                            <span className="hidden sm:inline">Estudiar</span>
                          </Link>
                        </Button>
                      )}
                      {course.id && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() =>
                            setEditingColorCourseId((cur) =>
                              cur === course.id ? null : course.id!,
                            )
                          }
                          className="h-8 w-8 text-muted-foreground hover:text-accent"
                          title="Color del curso (se usa en el calendario)"
                        >
                          <Palette className="h-3.5 w-3.5" style={{ color: folderColor }} />
                        </Button>
                      )}
                      {course.id && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => startTermEdit(course.id!)}
                          className={`h-8 w-8 ${
                            courses.find((c) => c.id === course.id)?.term_start
                              ? "text-accent"
                              : "text-muted-foreground hover:text-accent"
                          }`}
                          title="Inicio del semestre (ubica los eventos 'Semana N' en el calendario)"
                        >
                          <CalendarDays className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {course.id && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => startCourseRename(course.id!, course.name)}
                          className="h-8 w-8 text-muted-foreground hover:text-accent"
                          title="Renombrar curso"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {course.id && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() =>
                            handleDeleteCourse(course.id!, course.name, course.docs.length)
                          }
                          className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          title="Eliminar curso"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                    {editingColorCourseId === course.id && course.id ? (
                      <div className="flex items-center gap-3 px-4 py-3 pr-24 sm:pr-40">
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                          style={{ backgroundColor: colorTint(folderColor!) }}
                        >
                          <Palette className="h-[18px] w-[18px]" style={{ color: folderColor }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                            Color del curso — se usa en esta carpeta y en el calendario de la Agenda
                          </span>
                          <CourseColorPicker
                            value={folderColor!}
                            onChange={(hex) => commitCourseColor(course.id!, hex)}
                            disabled={savingColor}
                          />
                        </div>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => setEditingColorCourseId(null)}
                          title="Cerrar"
                        >
                          {savingColor ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <X className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    ) : editingTermCourseId === course.id && course.id ? (
                      <div className="flex items-center gap-2 px-4 py-3 pr-24 sm:pr-40">
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10"
                          style={
                            folderColor ? { backgroundColor: colorTint(folderColor) } : undefined
                          }
                        >
                          <CalendarDays
                            className="h-[18px] w-[18px] text-accent"
                            style={folderColor ? { color: folderColor } : undefined}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="block text-xs font-medium text-muted-foreground">
                            Inicio del semestre (lunes de la semana 1) — ubica los eventos
                            &ldquo;Semana N&rdquo; en el calendario
                          </span>
                          <Input
                            autoFocus
                            type="date"
                            value={termValue}
                            onChange={(e) => setTermValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitTermStart(course.id!)
                              if (e.key === "Escape") setEditingTermCourseId(null)
                            }}
                            className="mt-1 h-8 max-w-[200px]"
                          />
                        </div>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => commitTermStart(course.id!)}
                          disabled={savingTerm}
                          className="text-accent"
                          title="Guardar"
                        >
                          {savingTerm ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => setEditingTermCourseId(null)}
                          title="Cancelar"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : renamingCourseId === course.id && course.id ? (
                      <div className="flex items-center gap-2 px-4 py-3 pr-24 sm:pr-40">
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10"
                          style={
                            folderColor ? { backgroundColor: colorTint(folderColor) } : undefined
                          }
                        >
                          <BookText
                            className="h-[18px] w-[18px] text-accent"
                            style={folderColor ? { color: folderColor } : undefined}
                          />
                        </div>
                        <Input
                          autoFocus
                          value={courseRenameValue}
                          onChange={(e) => setCourseRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitCourseRename(course.id!)
                            if (e.key === "Escape") setRenamingCourseId(null)
                          }}
                          className="h-8 flex-1"
                        />
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => commitCourseRename(course.id!)}
                          disabled={savingCourseRename}
                          className="text-accent"
                          title="Guardar"
                        >
                          {savingCourseRename ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => setRenamingCourseId(null)}
                          title="Cancelar"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <AccordionTrigger className="pr-24 sm:pr-40">
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10"
                          style={
                            folderColor ? { backgroundColor: colorTint(folderColor) } : undefined
                          }
                        >
                          <BookText
                            className="h-[18px] w-[18px] text-accent"
                            style={folderColor ? { color: folderColor } : undefined}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-foreground">
                            {course.name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {course.docs.length}{" "}
                            {course.docs.length === 1 ? "documento" : "documentos"} · clic para ver
                          </span>
                        </div>
                      </AccordionTrigger>
                    )}

                    <AccordionContent className="p-0">
                      <ul className="divide-y divide-border/40">
                        {course.docs.map((doc) => {
                          const sv = getDocStatus(doc as any)
                          const optimistic = !!(doc as any)._optimistic
                          const canDrag = !optimistic && renamingId !== doc.id
                          const RowIcon = docRowIcon(doc.source_type)
                          const descriptor = docDescriptor(doc)
                          return (
                            <li
                              key={doc.id}
                              draggable={canDrag}
                              onDragStart={canDrag ? onDocDragStart(doc) : undefined}
                              onDragEnd={onDocDragEnd}
                              className={`group flex items-center gap-1.5 px-3 py-2.5 text-sm transition-opacity sm:gap-3 sm:px-4 ${
                                draggingDoc?.id === doc.id ? "opacity-40" : ""
                              }`}
                            >
                              {renamingId === doc.id ? (
                                <div className="flex flex-1 items-center gap-2">
                                  <Input
                                    autoFocus
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") commitRename(doc.id)
                                      if (e.key === "Escape") setRenamingId(null)
                                    }}
                                    className="h-8 flex-1"
                                  />
                                  <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    onClick={() => commitRename(doc.id)}
                                    disabled={isSavingRename}
                                    className="text-accent"
                                    title="Guardar"
                                  >
                                    {isSavingRename ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Check className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                  <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    onClick={() => setRenamingId(null)}
                                    title="Cancelar"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ) : (
                                <>
                                  {canDrag && (
                                    <GripVertical
                                      className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground/40 active:cursor-grabbing"
                                      aria-hidden
                                    />
                                  )}
                                  <RowIcon className="h-4 w-4 shrink-0 text-accent/70" />
                                  <span
                                    className="min-w-0 flex-1 truncate"
                                    title={
                                      doc.source_type === "link" && doc.source_url
                                        ? `${doc.original_filename} — ${doc.source_url}`
                                        : doc.original_filename
                                    }
                                  >
                                    {doc.original_filename}
                                    {descriptor && (
                                      <span className="ml-2 text-xs text-muted-foreground">
                                        {descriptor}
                                      </span>
                                    )}
                                  </span>
                                  <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    onClick={() => startRename(doc)}
                                    className="invisible h-6 w-6 text-muted-foreground group-hover:visible"
                                    title="Renombrar"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                                    {new Date(doc.created_at).toLocaleDateString()}
                                  </span>
                                  <Badge variant={sv.tone} title={sv.tooltip} className="shrink-0">
                                    {(sv.tone === "error" || sv.tone === "warn") && (
                                      <AlertTriangle className="h-3 w-3" />
                                    )}
                                    {sv.label}
                                  </Badge>
                                  {sv.canReprocess && (
                                    <Button
                                      size="icon-sm"
                                      variant="ghost"
                                      onClick={() => handleReprocessRow(doc.id)}
                                      disabled={reprocessingId === doc.id}
                                      className="text-muted-foreground"
                                      title="Reprocesar"
                                    >
                                      <RefreshCw
                                        className={`h-3.5 w-3.5 ${reprocessingId === doc.id ? "animate-spin" : ""}`}
                                      />
                                    </Button>
                                  )}
                                  <MoveMenu
                                    doc={doc}
                                    targets={realCourses}
                                    optimistic={optimistic}
                                    onMove={handleMove}
                                  />
                                  <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    onClick={() => handlePreview(doc)}
                                    disabled={optimistic}
                                    title="Vista previa del documento"
                                  >
                                    <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                                  </Button>
                                  <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    onClick={() => handleChat(doc.id, doc.original_filename)}
                                    disabled={optimistic}
                                    title="Chatear"
                                  >
                                    <MessageSquare className="h-3.5 w-3.5 text-accent" />
                                  </Button>
                                  <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    onClick={() => handleDelete(doc.id, doc.original_filename)}
                                    disabled={optimistic}
                                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                    title="Eliminar"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                      {course.id && (
                        <div className="border-t border-border/40 px-3 py-2 sm:px-4">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5 text-muted-foreground hover:text-accent"
                            onClick={() => {
                              setAddCourseId(course.id!)
                              setAddTab("pdf")
                              setAddOpen(true)
                            }}
                          >
                            <Plus className="h-4 w-4" />
                            Añadir fuente
                          </Button>
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
            </Accordion>
          )}

          {/* Archivo de temas: every generated topic, grouped by course. */}
          <TopicsArchive />
          </div>

          {/* ═══ Right column: Agenda (calendario + notas) ═══ */}
          <div className="min-w-0">
            <AgendaPanel />
          </div>
        </div>
      </div>

      {/* Trash drop zone — only visible while dragging a document. */}
      {draggingDoc && (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = "move"
            if (dragOverKey !== "__trash__") setDragOverKey("__trash__")
          }}
          onDragLeave={() => dragOverKey === "__trash__" && setDragOverKey(null)}
          onDrop={onTrashDrop}
          className={`fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border-2 border-dashed px-5 py-3 text-sm font-semibold shadow-lg transition-colors ${
            dragOverKey === "__trash__"
              ? "border-destructive bg-destructive text-destructive-foreground"
              : "border-destructive/50 bg-card text-destructive"
          }`}
        >
          <Trash2 className="h-4 w-4" />
          Soltar aquí para eliminar
        </div>
      )}

      {/* Confirmation dialog (delete document/course, duplicate upload) */}
      {confirmDialog}

      {/* Create Course Dialog */}
      <Dialog
        open={createCourseOpen}
        onOpenChange={(open) => !creatingCourse && setCreateCourseOpen(open)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo curso</DialogTitle>
            <DialogDescription>
              Crea una carpeta de curso. Luego asígnale documentos desde las sugerencias o el menú
              «mover».
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={newCourseName}
            placeholder="Nombre del curso"
            onChange={(e) => setNewCourseName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateCourse()}
          />

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Color</span>
              <span
                className="h-3.5 w-3.5 rounded-full"
                style={{ background: newCourseColor }}
                aria-hidden
              />
              <span className="text-[11px] text-muted-foreground">
                elegido al azar — cámbialo si quieres
              </span>
            </div>
            <CourseColorPicker
              value={newCourseColor}
              onChange={setNewCourseColor}
              disabled={creatingCourse}
            />
            <p className="text-[11px] text-muted-foreground">
              Es el color con el que el curso se pinta en la carpeta y en el calendario de la
              Agenda.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setCreateCourseOpen(false)}
              disabled={creatingCourse}
            >
              Cancelar
            </Button>
            <Button
              variant="accent"
              onClick={handleCreateCourse}
              disabled={creatingCourse || !newCourseName.trim()}
            >
              {creatingCourse ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FolderPlus className="h-4 w-4" />
              )}
              Crear curso
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Source Dialog (PDF / Link / Text) */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (isAdding) return
          if (!open) setFileDragActive(false)
          setAddOpen(open)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {addCourseId
                ? `Añadir fuente a ${courses.find((c) => c.id === addCourseId)?.name ?? "curso"}`
                : "Añadir fuente"}
            </DialogTitle>
            <DialogDescription>
              {addCourseId
                ? "Sube un archivo (PDF, Word, PowerPoint, Excel), pega un enlace o escribe texto. Se asignará directamente a este curso."
                : "Sube un archivo (PDF, Word, PowerPoint, Excel), pega un enlace o escribe texto. Todo se indexa para el chat."}
            </DialogDescription>
          </DialogHeader>

          <div className="mb-3 inline-flex gap-1 rounded-lg border border-border bg-card/50 p-0.5">
            {[
              { id: "pdf" as const, label: "Archivo", Icon: FileIcon },
              { id: "link" as const, label: "Enlace", Icon: Link2 },
              { id: "text" as const, label: "Texto", Icon: Type },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setAddTab(t.id)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  addTab === t.id
                    ? "bg-accent/15 text-accent"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <t.Icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            ))}
          </div>

          {addTab === "pdf" && (
            <div
              onDragOver={(e) => {
                if (!Array.from(e.dataTransfer.types).includes("Files")) return
                e.preventDefault()
                e.dataTransfer.dropEffect = "copy"
                if (!fileDragActive) setFileDragActive(true)
              }}
              onDragLeave={(e) => {
                // Ignore leave events bubbling from children inside the zone.
                if (e.currentTarget.contains(e.relatedTarget as Node)) return
                setFileDragActive(false)
              }}
              onDrop={handleFileDrop}
              className={`flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center transition-colors ${
                fileDragActive ? "border-accent bg-accent/10" : "border-border/70"
              }`}
            >
              <FileIcon
                className={`h-8 w-8 ${fileDragActive ? "text-accent" : "text-muted-foreground/40"}`}
              />
              <p className="text-sm text-muted-foreground">
                Arrastra aquí tus archivos o selecciónalos. PDF, Word, PowerPoint o Excel (máx. 25MB
                cada uno).
              </p>
              <Button
                variant="accent"
                size="sm"
                onClick={() => {
                  setAddOpen(false)
                  handleUploadClick()
                }}
              >
                <Plus className="h-4 w-4" /> Elegir archivo
              </Button>
            </div>
          )}

          {addTab === "link" && (
            <div className="flex flex-col gap-3">
              <Input
                type="url"
                placeholder="https://ejemplo.com/articulo"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddLink()}
              />
              <Button
                variant="accent"
                onClick={handleAddLink}
                disabled={isAdding || !linkUrl.trim()}
                className="self-end"
              >
                {isAdding ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
                Añadir enlace
              </Button>
            </div>
          )}

          {addTab === "text" && (
            <div className="flex flex-col gap-3">
              <Input
                type="text"
                placeholder="Título (opcional)"
                value={textTitle}
                onChange={(e) => setTextTitle(e.target.value)}
              />
              <textarea
                placeholder="Pega o escribe el contenido…"
                value={textBody}
                onChange={(e) => setTextBody(e.target.value)}
                rows={8}
                className="max-h-64 min-h-32 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
              <Button
                variant="accent"
                onClick={handleAddText}
                disabled={isAdding || !textBody.trim()}
                className="self-end"
              >
                {isAdding ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Type className="h-4 w-4" />
                )}
                Añadir texto
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Graph Preview Dialog */}
      <Dialog
        open={!!previewDoc}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewDoc(null)
            setPreviewGraph(null)
          }
        }}
      >
        <DialogContent className="flex h-[calc(100dvh-3rem)] w-full max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="flex-col items-start justify-between gap-2 border-b border-border/60 px-4 py-3 pr-12 text-left sm:flex-row sm:items-center sm:gap-3">
            <div className="min-w-0">
              <DialogTitle className="truncate text-base">{previewDoc?.name}</DialogTitle>
              <DialogDescription className="text-xs">Vista previa del documento</DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                variant="accent"
                disabled={!previewReady}
                title={
                  previewReady
                    ? "Abrir el chat preguntando sobre este documento"
                    : "Disponible cuando el documento esté listo"
                }
                onClick={() => previewDoc && handleChat(previewDoc.id, previewDoc.name)}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Pregúntame sobre este documento</span>
                <span className="sm:hidden">Preguntar</span>
              </Button>
              <div className="inline-flex gap-1 rounded-lg border border-border bg-card/50 p-0.5">
                <button
                  onClick={() => setPreviewMode("pdf")}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    previewMode === "pdf"
                      ? "bg-accent/15 text-accent"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <FileIcon className="h-3.5 w-3.5" />{" "}
                  {!previewDoc?.sourceType || previewDoc.sourceType === "pdf" ? "PDF" : "Documento"}
                </button>
                <button
                  onClick={showGraphPreview}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    previewMode === "graph"
                      ? "bg-accent/15 text-accent"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <NetworkIcon className="h-3.5 w-3.5" /> Mapa
                </button>
              </div>
            </div>
          </DialogHeader>
          {previewNeedsOcr && (
            <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {NEEDS_OCR_HINT} No se usará como contexto del chat hasta que tenga texto.
              </span>
            </div>
          )}
          <div className="relative min-h-0 flex-1 bg-background/50">
            {previewMode === "pdf" ? (
              previewDoc?.fileUrl && (!previewDoc.sourceType || previewDoc.sourceType === "pdf") ? (
                <iframe
                  src={previewDoc.fileUrl}
                  title={previewDoc.name}
                  className="absolute inset-0 h-full w-full border-0"
                />
              ) : previewDoc?.fileUrl ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
                  <FileIcon className="h-10 w-10 opacity-20" />
                  <p>Este formato no se puede previsualizar aquí.</p>
                  <Button variant="outline" size="sm" asChild>
                    <a href={previewDoc.fileUrl} target="_blank" rel="noopener noreferrer">
                      <FileIcon className="h-3.5 w-3.5" /> Descargar archivo
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" onClick={showGraphPreview}>
                    <NetworkIcon className="h-3.5 w-3.5" /> Ver el mapa
                  </Button>
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
                  <FileIcon className="h-10 w-10 opacity-20" />
                  <p>
                    {previewDoc?.sourceType === "link"
                      ? "Esta fuente es un enlace web — su contenido ya está indexado para el chat."
                      : "El archivo no está disponible para este documento."}
                  </p>
                  {previewDoc?.sourceType === "link" && previewDoc.sourceUrl && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={previewDoc.sourceUrl} target="_blank" rel="noopener noreferrer">
                        <Link2 className="h-3.5 w-3.5" /> Abrir enlace original
                      </a>
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={showGraphPreview}>
                    <NetworkIcon className="h-3.5 w-3.5" /> Ver el mapa
                  </Button>
                </div>
              )
            ) : previewLoading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : previewGraph && previewDoc ? (
              <GraphCanvas
                nodes={previewGraph.nodes}
                edges={previewGraph.edges}
                crossLinks={previewGraph.crossLinks}
                layout={previewGraph.layout}
                graphStatus={previewGraph.graph_status}
                graphError={previewGraph.graph_error}
                centerTitle={previewDoc.name.replace(/\.(pdf|docx|pptx|xlsx)$/i, "")}
                onReprocess={handleReprocess}
                editable
                syllabusId={previewDoc.id}
                onSaved={(g) => {
                  if ("syllabus_id" in g) setPreviewGraph(g)
                }}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                No se pudo cargar el mapa.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </main>
  )
}

/** Per-document "move to another course" menu, backed by the real course_id FK. */
function MoveMenu({
  doc,
  targets,
  optimistic,
  onMove,
}: {
  doc: SyllabusUploadAPI
  targets: RealCourse[]
  optimistic: boolean
  onMove: (doc: SyllabusUploadAPI, targetCourseId: string | null) => void
}) {
  const current = doc.course_id ?? null
  const others = targets.filter((t) => t.id !== current)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={optimistic}
          className="text-muted-foreground"
          title="Mover a otro curso"
        >
          <FolderInput className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Mover a…</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {others.length === 0 ? (
          <DropdownMenuItem disabled>No hay otros cursos</DropdownMenuItem>
        ) : (
          others.map((t) => (
            <DropdownMenuItem key={t.id} onClick={() => onMove(doc, t.id)}>
              <span
                className="mr-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-accent"
                style={t.color ? { backgroundColor: t.color } : undefined}
              />
              <span className="truncate">{t.name}</span>
            </DropdownMenuItem>
          ))
        )}
        {current && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onMove(doc, null)}>Quitar de curso</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
