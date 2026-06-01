"use client"

import type React from "react"

import { ArrowUp, ChevronDown, FileText, Paperclip, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import type { AttachedFile } from "@/components/navigator/types"
import { fetchChatModels } from "@/lib/api"

const DEFAULT_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"]

export function ChatComposer({
  attachments,
  activeModel,
  hasSyllabus,
  onAddAttachment,
  onRemoveAttachment,
  onSend,
  onModelChange,
}: {
  attachments: AttachedFile[]
  activeModel?: string
  hasSyllabus?: boolean
  onAddAttachment: (file: AttachedFile) => void
  onRemoveAttachment: (id: string) => void
  onSend: (text: string) => void
  onModelChange?: (model: string) => void
}) {
  const [value, setValue] = useState("")
  const [isDragging, setIsDragging] = useState(false)
  const [models, setModels] = useState<string[]>(DEFAULT_MODELS)
  const [modelOpen, setModelOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const modelRef = useRef<HTMLDivElement>(null)

  const hasText = value.trim().length > 0
  const currentModel = activeModel ?? models[0] ?? "gpt-4o-mini"
  const canSend = hasText && hasSyllabus

  useEffect(() => {
    fetchChatModels()
      .then((data) => setModels(data.models))
      .catch(() => setModels(DEFAULT_MODELS))
  }, [])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) {
        setModelOpen(false)
      }
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragging(false)
      const dropped = Array.from(e.dataTransfer.files).filter((f) => f.type === "application/pdf")
      dropped.forEach((f, i) =>
        onAddAttachment({
          id: `${Date.now()}-${i}`,
          name: f.name,
          size: `${(f.size / (1024 * 1024)).toFixed(1)} MB`,
          file: f,
          status: "uploading",
        }),
      )
    },
    [onAddAttachment],
  )

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const picked = Array.from(e.target.files ?? []).filter((f) => f.type === "application/pdf")
      picked.forEach((f, i) =>
        onAddAttachment({
          id: `${Date.now()}-${i}`,
          name: f.name,
          size: `${(f.size / (1024 * 1024)).toFixed(1)} MB`,
          file: f,
          status: "uploading",
        }),
      )
      e.target.value = ""
    },
    [onAddAttachment],
  )

  const handleSend = () => {
    if (!canSend) return
    onSend(value)
    setValue("")
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="animate-fade-up-delay-3 flex flex-col gap-2">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={cn(
          "rounded-2xl border bg-card shadow-sm transition-colors",
          isDragging ? "border-accent ring-2 ring-accent/20" : "border-border",
        )}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-border/60 px-3 py-2">
            {attachments.map((f) => (
              <span
                key={f.id}
                className={cn(
                  "group inline-flex items-center gap-1.5 rounded-md border py-1 pl-2 pr-1 text-xs transition-colors",
                  f.status === "uploading"
                    ? "border-accent/50 bg-accent/10 text-accent animate-pulse"
                    : f.status === "error"
                      ? "border-red-500/50 bg-red-500/10 text-red-500"
                      : "border-border bg-secondary/60 text-foreground",
                )}
              >
                <FileText
                  className={cn("h-3.5 w-3.5", f.status === "error" ? "text-red-500" : "text-accent")}
                  strokeWidth={2.25}
                />
                <span className="max-w-[160px] truncate">{f.name}</span>
                <span className={cn(f.status === "error" ? "text-red-500/70" : "text-muted-foreground")}>
                  {f.status === "uploading" ? "Uploading..." : f.status === "error" ? "Failed" : f.size}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(f.id)}
                  aria-label={`Remove ${f.name}`}
                  className="ml-0.5 flex h-4 w-4 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 px-3 py-2.5">
          <div className="relative" ref={modelRef}>
            <button
              type="button"
              onClick={() => setModelOpen((v) => !v)}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
              aria-label="Select model"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              <span className="max-w-[100px] truncate">{currentModel}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2.25} />
            </button>
            {modelOpen && (
              <div className="absolute bottom-full left-0 z-50 mb-1 min-w-[160px] rounded-lg border border-border bg-card py-1 shadow-lg">
                {models.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      onModelChange?.(m)
                      setModelOpen(false)
                    }}
                    className={cn(
                      "flex w-full px-3 py-2 text-left text-xs hover:bg-secondary",
                      m === currentModel && "font-semibold text-accent",
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Attach a PDF"
          >
            <Paperclip className="h-4 w-4" />
          </button>

          <input ref={inputRef} type="file" accept="application/pdf" multiple onChange={onPick} className="sr-only" />

          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              isDragging
                ? "Drop PDFs to attach…"
                : hasSyllabus
                  ? "Type your message..."
                  : "Upload a PDF first, then ask questions..."
            }
            rows={1}
            className="min-h-9 max-h-40 flex-1 resize-none bg-transparent py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
          />

          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-all duration-200",
              canSend
                ? "bg-accent text-accent-foreground shadow-sm hover:opacity-90"
                : "bg-secondary text-muted-foreground/70",
            )}
            aria-label="Send message"
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
      </div>

      <div className="flex h-4 items-center justify-between px-1">
        {!hasSyllabus && (
          <p className="text-[11px] text-muted-foreground">Attach a syllabus PDF to enable chat.</p>
        )}
        {value.length === 0 && hasSyllabus && (
          <p className="ml-auto hidden text-[11px] text-muted-foreground sm:block">
            Press <kbd className="rounded border border-border bg-secondary px-1 font-mono text-[10px]">Enter</kbd> to send
          </p>
        )}
      </div>
    </div>
  )
}
