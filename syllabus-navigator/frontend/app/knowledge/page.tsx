"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import { listSyllabi, uploadSyllabus, deleteSyllabus, fetchGraph, reprocessGraph } from "@/lib/api"
import type { SyllabusUploadAPI, GraphResponseAPI } from "@/lib/api"
import { Search, Plus, FileText, Loader2, Library, MessageSquare, Trash2, Eye, X } from "lucide-react"
import { useRef } from "react"
import { toast } from "sonner"
import GraphCanvas from "@/components/GraphCanvas"

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
  
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  useEffect(() => {
    if (!ready) return
    if (status === "anonymous" || status === "guest") {
      setLoading(false)
      return
    }

    let isMounted = true
    let intervalId: ReturnType<typeof setInterval> | null = null

    const fetchUploads = async (isPolling = false) => {
      try {
        if (!isPolling) setLoading(true)
        const data = await listSyllabi()
        if (isMounted) {
          setUploads(data.uploads)
          setError(null)

          const needsPolling = data.uploads.some(
            (u) =>
              u.status === "pending" ||
              u.graph_status === "pending" ||
              u.graph_status === "processing"
          )
          
          if (needsPolling && !intervalId) {
            intervalId = setInterval(() => fetchUploads(true), 3000)
          } else if (!needsPolling && intervalId) {
            clearInterval(intervalId)
            intervalId = null
          }
        }
      } catch (err) {
        if (isMounted && !isPolling) setError("Failed to load documents.")
      } finally {
        if (isMounted && !isPolling) setLoading(false)
      }
    }

    fetchUploads()

    return () => {
      isMounted = false
      if (intervalId) clearInterval(intervalId)
    }
  }, [ready, status])

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    setIsUploading(true)
    for (const file of files) {
      if (file.type !== "application/pdf") {
        toast.error(`${file.name} is not a PDF.`)
        continue
      }
      try {
        await uploadSyllabus(file)
        toast.success(`${file.name} uploaded successfully.`)
      } catch (err) {
        toast.error(`Failed to upload ${file.name}.`)
      }
    }
    setIsUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
    
    // Refresh list immediately
    listSyllabi().then((data) => setUploads(data.uploads)).catch(console.error)
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete ${name}?`)) return
    try {
      await deleteSyllabus(id)
      setUploads((prev) => prev.filter((u) => u.id !== id))
      toast.success("Document deleted.")
    } catch (err) {
      toast.error("Failed to delete document.")
    }
  }

  const handleChat = (id: string, name: string) => {
    router.push(`/?docId=${encodeURIComponent(id)}&docName=${encodeURIComponent(name)}`)
  }

  const handlePreview = async (id: string, name: string) => {
    setPreviewDoc({ id, name })
    setPreviewLoading(true)
    try {
      const data = await fetchGraph(id)
      setPreviewGraph(data)
    } catch (err) {
      toast.error("Failed to load graph preview.")
      setPreviewGraph(null)
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
    } catch (err) {
      toast.error("Failed to reprocess graph.")
    }
  }

  // Simple auth gate representation
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
                  onClick={() => window.location.reload()}
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
                    <tr key={doc.id} className="hover:bg-secondary/20 transition-colors">
                      <td className="px-6 py-4 font-medium flex items-center gap-2">
                        <FileText className="h-4 w-4 text-accent/70" />
                        {doc.original_filename}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {new Date(doc.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          doc.status === 'ready' 
                            ? 'bg-green-500/10 text-green-500'
                            : doc.status === 'error'
                              ? 'bg-red-500/10 text-red-500'
                              : 'bg-accent/10 text-accent animate-pulse'
                        }`}>
                          {doc.status.charAt(0).toUpperCase() + doc.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right flex justify-end gap-2">
                        <button
                          onClick={() => handlePreview(doc.id, doc.original_filename)}
                          className="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                        >
                          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                          Preview
                        </button>
                        <button
                          onClick={() => handleChat(doc.id, doc.original_filename)}
                          className="flex items-center gap-1.5 rounded-md bg-secondary/80 px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                        >
                          <MessageSquare className="h-3.5 w-3.5 text-accent" />
                          Chat
                        </button>
                        <button
                          onClick={() => handleDelete(doc.id, doc.original_filename)}
                          className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                          title="Delete document"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
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
                onClick={() => {
                  setPreviewDoc(null)
                  setPreviewGraph(null)
                }}
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
