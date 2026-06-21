"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import { listSyllabi, uploadSyllabus, deleteSyllabus, fetchGraph, reprocessGraph, renameDocument } from "@/lib/api"
import type { SyllabusUploadAPI, GraphResponseAPI } from "@/lib/api"
import { Search, Plus, FileText, Loader2, Library, MessageSquare, Trash2, Eye, X, Pencil, Check, RefreshCw, AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import GraphCanvas from "@/components/GraphCanvas"

type DocTone = "ok" | "error" | "warn" | "pending"
interface DocStatusView {
  label: string
  tone: DocTone
  tooltip?: string
  canReprocess: boolean
}

function getDocStatus(doc: SyllabusUploadAPI & { _optimistic?: boolean }): DocStatusView {
  if (doc._optimistic) return { label: "Uploading…", tone: "pending", canReprocess: false }

  if (doc.status === "error") {
    return {
      label: "Failed",
      tone: "error",
      tooltip: doc.error_message ?? "Processing failed.",
      canReprocess: true,
    }
  }
  if (doc.status === "pending") {
    return { label: "Processing…", tone: "pending", canReprocess: false }
  }

  // status === "processed" → look at the graph stage
  if (doc.graph_status === "failed") {
    return {
      label: "Graph failed",
      tone: "warn",
      tooltip: doc.graph_error ?? "Graph generation failed.",
      canReprocess: true,
    }
  }
  if (doc.graph_status === "pending" || doc.graph_status === "processing") {
    return { label: "Building graph…", tone: "pending", canReprocess: false }
  }
  return { label: "Ready", tone: "ok", canReprocess: false }
}

const TONE_CLASS: Record<DocTone, string> = {
  ok: "bg-green-500/10 text-green-500",
  error: "bg-red-500/10 text-red-500",
  warn: "bg-amber-500/10 text-amber-500",
  pending: "bg-accent/10 text-accent animate-pulse",
}

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
          Knowledge Base
        </h1>
        <button 
          onClick={handleUploadClick}
          disabled={isUploading}
          className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {isUploading ? "Uploading..." : "Add Source"}
        </button>
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
          <div className="mb-6 flex items-center justify-between">
            <div className="relative w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 w-full rounded-full border border-border/60 bg-secondary/50 pl-9 pr-4 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent transition-all"
              />
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
            {loading ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="flex h-64 flex-col items-center justify-center text-center p-6">
                <p className="text-red-500 mb-2">{error}</p>
                <button 
                  onClick={() => fetchUploads()}
                  className="text-sm underline text-muted-foreground hover:text-foreground"
                >
                  Retry
                </button>
              </div>
            ) : filteredUploads.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center text-center p-6 text-muted-foreground">
                <FileText className="h-10 w-10 mb-3 opacity-20" />
                <p className="text-sm font-medium mb-1">
                  {searchQuery ? "No documents found." : "Your library is empty."}
                </p>
                <p className="text-xs">
                  {searchQuery ? "Try a different search term." : "Upload a PDF document to get started."}
                </p>
              </div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-secondary/40 border-b border-border/60 text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3 font-medium">Name</th>
                    <th className="px-6 py-3 font-medium">Date Added</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                    <th className="px-6 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredUploads.map((doc) => (
                    <tr key={doc.id} className="hover:bg-secondary/20 transition-colors group">
                      <td className="px-6 py-4 font-medium">
                        {renamingId === doc.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitRename(doc.id)
                                if (e.key === "Escape") setRenamingId(null)
                              }}
                              className="flex-1 rounded border border-accent bg-background px-2 py-0.5 text-sm focus:outline-none"
                            />
                            <button
                              onClick={() => commitRename(doc.id)}
                              disabled={isSavingRename}
                              className="text-accent hover:text-accent/80"
                              title="Save"
                            >
                              {isSavingRename ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            </button>
                            <button onClick={() => setRenamingId(null)} className="text-muted-foreground hover:text-foreground" title="Cancel">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-accent/70 shrink-0" />
                            <span
                              className="truncate max-w-[260px]"
                              title={doc.original_filename}
                            >
                              {doc.original_filename}
                            </span>
                            <button
                              onClick={() => startRename(doc)}
                              className="invisible group-hover:visible text-muted-foreground hover:text-foreground transition-colors"
                              title="Rename"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {new Date(doc.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        {(() => {
                          const sv = getDocStatus(doc as any)
                          return (
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[sv.tone]}`}
                                title={sv.tooltip}
                              >
                                {(sv.tone === "error" || sv.tone === "warn") && (
                                  <AlertTriangle className="h-3 w-3" />
                                )}
                                {sv.label}
                              </span>
                              {sv.canReprocess && (
                                <button
                                  onClick={() => handleReprocessRow(doc.id)}
                                  disabled={reprocessingId === doc.id}
                                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                                  title="Reprocess this document"
                                >
                                  <RefreshCw className={`h-3 w-3 ${reprocessingId === doc.id ? "animate-spin" : ""}`} />
                                  Retry
                                </button>
                              )}
                            </div>
                          )
                        })()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handlePreview(doc.id, doc.original_filename)}
                            disabled={!!(doc as any)._optimistic}
                            className="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
                          >
                            <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                            Preview
                          </button>
                          <button
                            onClick={() => handleChat(doc.id, doc.original_filename)}
                            disabled={!!(doc as any)._optimistic}
                            className="flex items-center gap-1.5 rounded-md bg-secondary/80 px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
                          >
                            <MessageSquare className="h-3.5 w-3.5 text-accent" />
                            Chat
                          </button>
                          <button
                            onClick={() => handleDelete(doc.id, doc.original_filename)}
                            disabled={!!(doc as any)._optimistic}
                            className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40"
                            title="Delete document"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Graph Preview Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 sm:p-6">
          <div className="flex h-full w-full max-w-5xl flex-col rounded-xl border border-border/60 bg-card shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <header className="flex items-center justify-between border-b border-border/60 px-4 py-3 shrink-0">
              <div>
                <h3 className="font-semibold">{previewDoc.name}</h3>
                <p className="text-xs text-muted-foreground">Knowledge Graph Preview</p>
              </div>
              <button
                onClick={() => { setPreviewDoc(null); setPreviewGraph(null) }}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="flex-1 min-h-0 relative bg-background/50">
              {previewLoading ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : previewGraph ? (
                <GraphCanvas
                  nodes={previewGraph.nodes}
                  edges={previewGraph.edges}
                  graphStatus={previewGraph.graph_status}
                  graphError={previewGraph.graph_error}
                  onReprocess={handleReprocess}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                  Failed to load graph data.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
