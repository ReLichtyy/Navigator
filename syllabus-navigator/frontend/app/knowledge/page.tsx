"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import { listSyllabi, uploadSyllabus, deleteSyllabus, fetchGraph, reprocessGraph, renameDocument } from "@/lib/api"
import type { SyllabusUploadAPI, GraphResponseAPI } from "@/lib/api"
import Link from "next/link"
import { Search, Plus, FolderPlus, FileText, Loader2, Library, BookText, GraduationCap, MessageSquare, Trash2, Eye, Pencil, Check, RefreshCw, AlertTriangle, X } from "lucide-react"
import { toast } from "sonner"
import GraphCanvas from "@/components/GraphCanvas"
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
import { getDocStatus } from "@/lib/ui/doc-status"
import { groupByCourse } from "@/lib/ui/course-group"

export default function KnowledgeBasePage() {
  const { status, ready } = useUser()
  const { openAuthModal } = useAuthModal()
  
  const [uploads, setUploads] = useState<SyllabusUploadAPI[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [isUploading, setIsUploading] = useState(false)
  const [previewDoc, setPreviewDoc] = useState<{ id: string; name: string } | null>(null)
  const [previewGraph, setPreviewGraph] = useState<GraphResponseAPI | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  // Rename state: { [docId]: draftName }
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [isSavingRename, setIsSavingRename] = useState(false)
  
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
      const data = await listSyllabi()
      if (!isMountedRef.current) return
      
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
        (u) => u.status === "pending" || u.graph_status === "pending" || u.graph_status === "processing"
      )
      if (needsPolling && !intervalRef.current) {
        intervalRef.current = setInterval(() => fetchUploads(true), 3000)
      } else if (!needsPolling && intervalRef.current) {
        clearPolling()
      }
    } catch (err) {
      if (isMountedRef.current && !silent) setError("Failed to load documents.")
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

  const handleUploadClick = () => fileInputRef.current?.click()

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    if (fileInputRef.current) fileInputRef.current.value = ""

    const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB — must match document.service.ts

    setIsUploading(true)
    for (const file of files) {
      if (file.type !== "application/pdf") {
        toast.error(`${file.name} is not a PDF.`)
        continue
      }
      if (file.size === 0) {
        toast.error(`${file.name} is empty.`)
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name} exceeds the 5MB limit.`)
        continue
      }

      // BUG FIX #3 + Feature: Add optimistic row immediately
      const tempId = `optimistic-${Date.now()}`
      const optimisticRow: SyllabusUploadAPI & { _optimistic?: boolean } = {
        id: tempId,
        original_filename: file.name,
        status: "pending",
        graph_status: "pending",
        created_at: new Date().toISOString(),
        _optimistic: true,
      }
      setUploads((prev) => [optimisticRow as any, ...prev])

      try {
        await uploadSyllabus(file)
        toast.success(`${file.name} uploaded successfully.`)
      } catch (err: any) {
        toast.error(err?.message ?? `Failed to upload ${file.name}.`)
      } finally {
        // Remove the optimistic row
        setUploads((prev) => prev.filter((u) => u.id !== tempId))
      }
    }

    setIsUploading(false)
    // BUG FIX #3: Controlled refresh with loading state
    await fetchUploads(true)
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"?`)) return
    // Optimistic removal
    setUploads((prev) => prev.filter((u) => u.id !== id))
    try {
      await deleteSyllabus(id)
      toast.success("Document deleted.")
    } catch (err) {
      toast.error("Failed to delete document.")
      // Revert on failure
      await fetchUploads(true)
    }
  }

  const handleChat = (id: string, name: string) => {
    router.push(`/?docId=${encodeURIComponent(id)}&docName=${encodeURIComponent(name)}`)
  }

  const handlePreview = async (id: string, name: string) => {
    setPreviewDoc({ id, name })
    setPreviewLoading(true)
    setPreviewGraph(null)
    try {
      const data = await fetchGraph(id)
      setPreviewGraph(data)
    } catch {
      toast.error("Failed to load graph preview.")
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleReprocess = async () => {
    if (!previewDoc) return
    try {
      const data = await reprocessGraph(previewDoc.id)
      setPreviewGraph(data)
      toast.success("Reprocessing started.")
    } catch {
      toast.error("Failed to reprocess graph.")
    }
  }

  const [reprocessingId, setReprocessingId] = useState<string | null>(null)

  const handleReprocessRow = async (id: string) => {
    setReprocessingId(id)
    try {
      await reprocessGraph(id)
      toast.success("Reprocessing started.")
      await fetchUploads(true)
    } catch {
      toast.error("Failed to start reprocessing.")
    } finally {
      setReprocessingId(null)
    }
  }

  const startRename = (doc: SyllabusUploadAPI) => {
    setRenamingId(doc.id)
    setRenameValue(doc.original_filename.replace(/\.pdf$/i, ""))
  }

  const commitRename = async (id: string) => {
    const trimmed = renameValue.trim()
    if (!trimmed) { setRenamingId(null); return }
    
    const newName = trimmed.endsWith(".pdf") ? trimmed : `${trimmed}.pdf`
    setIsSavingRename(true)
    try {
      await renameDocument(id, newName)
      setUploads((prev) => prev.map((u) => u.id === id ? { ...u, original_filename: newName } : u))
      toast.success("Document renamed.")
    } catch {
      toast.error("Failed to rename document.")
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
          <h2 className="text-xl font-semibold mb-2">Knowledge Base</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Sign in to create and manage your personal knowledge library. Upload documents to power your AI assistant.
          </p>
          <button
            onClick={() => openAuthModal("signup")}
            className="rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90"
          >
            Create an Account
          </button>
        </div>
      </main>
    )
  }

  const filteredUploads = uploads.filter((u) =>
    u.original_filename.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <main className="flex h-dvh w-full flex-col bg-background text-foreground overflow-hidden">
      <header className="flex h-14 items-center justify-between border-b border-border/60 px-6 shrink-0">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Library className="h-5 w-5 text-accent" />
          Cursos
        </h1>
        <div className="flex items-center gap-2">
          <Button onClick={handleUploadClick} disabled={isUploading} variant="outline" size="pill">
            <FolderPlus className="h-4 w-4" />
            Añadir curso
          </Button>
          <Button onClick={handleUploadClick} disabled={isUploading} variant="accent" size="pill">
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {isUploading ? "Subiendo…" : "Añadir fuente"}
          </Button>
        </div>
        <input 
          type="file" 
          ref={fileInputRef}
          accept="application/pdf"
          className="hidden"
          multiple
          onChange={handleFileChange}
        />
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl">
          <p className="mb-5 max-w-2xl text-sm text-muted-foreground">
            Cada curso tiene su propia carpeta de knowledge. Los modos de estudio se generan desde estos
            documentos.
          </p>

          <div className="mb-6 flex items-center justify-between">
            <div className="relative w-72">
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
              <Button variant="link" onClick={() => fetchUploads()} className="text-muted-foreground">
                Reintentar
              </Button>
            </div>
          ) : filteredUploads.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-border/60 bg-card text-center p-6 text-muted-foreground">
              <FileText className="h-10 w-10 mb-3 opacity-20" />
              <p className="text-sm font-medium mb-1">
                {searchQuery ? "No se encontraron cursos." : "Tu biblioteca está vacía."}
              </p>
              <p className="text-xs">
                {searchQuery ? "Prueba otro término de búsqueda." : "Sube un PDF de sílabo para empezar."}
              </p>
            </div>
          ) : (
            <Accordion type="multiple" className="flex flex-col gap-3">
              {groupByCourse(filteredUploads).map((course) => {
                const firstReady = course.docs.find((d) => d.status === "processed" && !(d as any)._optimistic)
                return (
                  <AccordionItem key={course.key} value={course.key} className="relative">
                    {firstReady && (
                      <Button
                        asChild
                        size="sm"
                        variant="secondary"
                        className="absolute right-3 top-2.5 z-10 h-8 gap-1.5"
                      >
                        <Link href={`/estudio?course=${firstReady.id}`}>
                          <GraduationCap className="h-3.5 w-3.5 text-accent" />
                          Estudiar
                        </Link>
                      </Button>
                    )}
                    <AccordionTrigger className="pr-28">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                        <BookText className="h-[18px] w-[18px] text-accent" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {course.code && (
                            <Badge variant="accent" className="font-mono text-[10px]">{course.code}</Badge>
                          )}
                          <span className="truncate font-semibold text-foreground">{course.name}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {course.docs.length} {course.docs.length === 1 ? "documento" : "documentos"} · clic para ver
                        </span>
                      </div>
                    </AccordionTrigger>

                    <AccordionContent className="p-0">
                      <ul className="divide-y divide-border/40">
                        {course.docs.map((doc) => {
                          const sv = getDocStatus(doc as any)
                          const optimistic = !!(doc as any)._optimistic
                          return (
                            <li key={doc.id} className="group flex items-center gap-3 px-4 py-2.5 text-sm">
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
                                  <Button size="icon-sm" variant="ghost" onClick={() => commitRename(doc.id)} disabled={isSavingRename} className="text-accent" title="Guardar">
                                    {isSavingRename ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                  </Button>
                                  <Button size="icon-sm" variant="ghost" onClick={() => setRenamingId(null)} title="Cancelar">
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ) : (
                                <>
                                  <FileText className="h-4 w-4 shrink-0 text-accent/70" />
                                  <span className="min-w-0 flex-1 truncate" title={doc.original_filename}>
                                    {doc.original_filename}
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
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    {new Date(doc.created_at).toLocaleDateString()}
                                  </span>
                                  <Badge variant={sv.tone} title={sv.tooltip} className="shrink-0">
                                    {(sv.tone === "error" || sv.tone === "warn") && <AlertTriangle className="h-3 w-3" />}
                                    {sv.label}
                                  </Badge>
                                  {sv.canReprocess && (
                                    <Button size="icon-sm" variant="ghost" onClick={() => handleReprocessRow(doc.id)} disabled={reprocessingId === doc.id} className="text-muted-foreground" title="Reprocesar">
                                      <RefreshCw className={`h-3.5 w-3.5 ${reprocessingId === doc.id ? "animate-spin" : ""}`} />
                                    </Button>
                                  )}
                                  <Button size="icon-sm" variant="ghost" onClick={() => handlePreview(doc.id, doc.original_filename)} disabled={optimistic} title="Vista previa del grafo">
                                    <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                                  </Button>
                                  <Button size="icon-sm" variant="ghost" onClick={() => handleChat(doc.id, doc.original_filename)} disabled={optimistic} title="Chatear">
                                    <MessageSquare className="h-3.5 w-3.5 text-accent" />
                                  </Button>
                                  <Button size="icon-sm" variant="ghost" onClick={() => handleDelete(doc.id, doc.original_filename)} disabled={optimistic} className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Eliminar">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
            </Accordion>
          )}
        </div>
      </div>

      {/* Graph Preview Dialog */}
      <Dialog
        open={!!previewDoc}
        onOpenChange={(open) => { if (!open) { setPreviewDoc(null); setPreviewGraph(null) } }}
      >
        <DialogContent className="flex h-[calc(100dvh-3rem)] w-full max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="border-b border-border/60 px-4 py-3 text-left">
            <DialogTitle className="text-base">{previewDoc?.name}</DialogTitle>
            <DialogDescription className="text-xs">Knowledge Graph Preview</DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 relative bg-background/50">
            {previewLoading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : previewGraph && previewDoc ? (
              <GraphCanvas
                nodes={previewGraph.nodes}
                edges={previewGraph.edges}
                graphStatus={previewGraph.graph_status}
                graphError={previewGraph.graph_error}
                onReprocess={handleReprocess}
                editable
                syllabusId={previewDoc.id}
                onSaved={(g) =>
                  setPreviewGraph((prev) =>
                    prev
                      ? {
                          ...prev,
                          nodes: g.nodes.map((n) => ({ ...n, weight_percent: n.weight_percent ?? 0 })),
                          edges: g.edges,
                        }
                      : prev,
                  )
                }
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                Failed to load graph data.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </main>
  )
}
