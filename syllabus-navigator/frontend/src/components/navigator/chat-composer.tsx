"use client"

import type React from "react"

import {
  ArrowUp,
  ChevronDown,
  FileText,
  Globe,
  Paperclip,
  Plus,
  X,
  Sparkles,
  CalendarDays,
  AlignLeft,
  HelpCircle,
  ListChecks,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import type { AttachedFile } from "@/components/navigator/types"
import { fetchChatModels, type ChatModelAPI } from "@/lib/api"

const DEFAULT_MODELS: ChatModelAPI[] = [
  { id: "gpt-4o-mini", displayName: "GPT-4o Mini" },
  { id: "gpt-4.1-mini", displayName: "GPT-4.1 Mini" },
]

// Quick-action tools: each sends a ready-made prompt to the assistant.
const TOOLS: { id: string; label: string; prompt: string; Icon: typeof CalendarDays }[] = [
  {
    id: "week",
    label: "¿Qué tengo esta semana?",
    prompt: "¿Qué quizes, exámenes y temas tengo esta semana según mis cronogramas?",
    Icon: CalendarDays,
  },
  {
    id: "summary",
    label: "Resume el curso",
    prompt: "Hazme un resumen ejecutivo de los temas principales del curso.",
    Icon: AlignLeft,
  },
  {
    id: "quiz",
    label: "Quiz rápido",
    prompt: "Hazme un quiz corto de 5 preguntas de opción múltiple sobre este curso, una por una.",
    Icon: HelpCircle,
  },
  {
    id: "topics",
    label: "Temas y su peso",
    prompt: "Lista los temas del curso y el peso de cada evaluación.",
    Icon: ListChecks,
  },
]

export function ChatComposer({
  attachments,
  activeModel,
  hasSyllabus,
  disabled,
  onAddAttachment,
  onRemoveAttachment,
  onSend,
  onModelChange,
  webSearch,
  onWebSearchChange,
}: {
  attachments: AttachedFile[]
  activeModel?: string
  hasSyllabus?: boolean
  disabled?: boolean
  onAddAttachment: (file: AttachedFile) => void
  onRemoveAttachment: (id: string) => void
  onSend: (text: string) => void | Promise<boolean>
  onModelChange?: (model: string) => void
  webSearch?: boolean
  onWebSearchChange?: (on: boolean) => void
}) {
  const [value, setValue] = useState("")
  const [isDragging, setIsDragging] = useState(false)
  // Self-managed when uncontrolled; mirrors `webSearch` prop when provided.
  const [webSearchInner, setWebSearchInner] = useState(false)
  const webSearchOn = webSearch ?? webSearchInner
  const toggleWebSearch = () => {
    const nextOn = !webSearchOn
    setWebSearchInner(nextOn)
    onWebSearchChange?.(nextOn)
  }
  const [models, setModels] = useState<ChatModelAPI[]>(DEFAULT_MODELS)
  const [modelOpen, setModelOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const modelRef = useRef<HTMLDivElement>(null)
  const toolsRef = useRef<HTMLDivElement>(null)

  const hasText = value.trim().length > 0
  const currentModelId = activeModel ?? models[0]?.id ?? "gpt-4o-mini"
  const currentModelLabel =
    models.find((m) => m.id === currentModelId)?.displayName ?? currentModelId
  const canSend = hasText && !disabled

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
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) {
        setToolsOpen(false)
      }
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  const runTool = (prompt: string) => {
    setToolsOpen(false)
    if (disabled) return
    void onSend(prompt)
  }

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

  const handleSend = async () => {
    if (!canSend) return
    const currentVal = value
    setValue("")
    const result = onSend(currentVal)
    if (result instanceof Promise) {
      const success = await result
      if (success === false) {
        setValue(currentVal) // Restore text on failure
      }
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="animate-fade-up-delay-3 flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple
        onChange={onPick}
        className="sr-only"
      />

      {/* ===== MOBILE dock (Chat Movil design): quick chips + pill input ===== */}
      <div className="flex flex-col gap-2 md:hidden">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((f) => (
              <span
                key={f.id}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border py-1 pl-2 pr-1 text-xs",
                  f.status === "uploading"
                    ? "border-accent/50 bg-accent/10 text-accent"
                    : f.status === "error"
                      ? "border-red-500/50 bg-red-500/10 text-red-500"
                      : "border-border bg-secondary/60 text-foreground",
                )}
              >
                <FileText className="h-3.5 w-3.5 text-accent" strokeWidth={2.25} />
                <span className="max-w-[140px] truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(f.id)}
                  aria-label={`Remove ${f.name}`}
                  className="ml-0.5 flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* quick chips — replace the desktop tools dropdown on mobile */}
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => runTool(t.prompt)}
              disabled={disabled}
              className="flex-none whitespace-nowrap rounded-[11px] border border-border bg-card/40 px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent disabled:opacity-50"
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* pill input dock */}
        <div className="flex items-end gap-2 rounded-[20px] border border-border bg-card/40 py-1.5 pl-3 pr-1.5">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
            aria-label="Adjuntar PDF"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
          >
            <Plus className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={toggleWebSearch}
            aria-pressed={webSearchOn}
            disabled={disabled}
            aria-label="Buscar en la web"
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-50",
              webSearchOn
                ? "border-accent/40 bg-accent/[0.06] text-accent"
                : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <Globe className="h-[18px] w-[18px]" />
          </button>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={isDragging ? "Suelta los PDFs…" : "Escribe tu mensaje…"}
            rows={1}
            disabled={disabled}
            // 16px (text-base) prevents iOS Safari auto-zoom on focus.
            className="min-h-8 max-h-32 flex-1 resize-none bg-transparent py-1.5 text-base leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Enviar mensaje"
            className={cn(
              "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full transition-all duration-150 active:scale-90",
              canSend
                ? "bg-[linear-gradient(135deg,#3FBF84,#2c9a66)] text-[#06140D]"
                : "bg-secondary text-muted-foreground/60",
            )}
          >
            <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {/* ===== DESKTOP composer card ===== */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={cn(
          "hidden rounded-2xl border bg-card shadow-sm transition-colors md:block",
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
                  className={cn(
                    "h-3.5 w-3.5",
                    f.status === "error" ? "text-red-500" : "text-accent",
                  )}
                  strokeWidth={2.25}
                />
                <span className="max-w-[160px] truncate">{f.name}</span>
                <span
                  className={cn(f.status === "error" ? "text-red-500/70" : "text-muted-foreground")}
                >
                  {f.status === "uploading" ? "Subiendo…" : f.status === "error" ? "Error" : f.size}
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

        <div className="flex flex-col gap-2 px-3 py-2.5">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={isDragging ? "Suelta los PDFs para adjuntar…" : "Escribe tu mensaje…"}
            rows={1}
            disabled={disabled}
            // 16px font on mobile (text-base) stops iOS Safari auto-zoom on focus;
            // drops back to 14px (text-sm) on sm+ where zoom isn't a concern.
            className="min-h-9 max-h-40 w-full resize-none bg-transparent px-1 py-2 text-base leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
          />

          <div className="flex items-center gap-2">
            <div className="relative" ref={modelRef}>
              <button
                type="button"
                onClick={() => setModelOpen((v) => !v)}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Select model"
                disabled={disabled}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                <span className="max-w-[120px] truncate">{currentModelLabel}</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2.25} />
              </button>
              {modelOpen && (
                <div className="absolute bottom-full left-0 z-50 mb-1 min-w-[160px] rounded-lg border border-border bg-card py-1 shadow-lg">
                  {models.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        onModelChange?.(m.id)
                        setModelOpen(false)
                      }}
                      className={cn(
                        "flex w-full px-3 py-2 text-left text-xs hover:bg-secondary",
                        m.id === currentModelId && "font-semibold text-accent",
                      )}
                    >
                      {m.displayName}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative" ref={toolsRef}>
              <button
                type="button"
                onClick={() => setToolsOpen((v) => !v)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Herramientas"
                disabled={disabled}
              >
                <Sparkles className="h-4 w-4" />
              </button>
              {toolsOpen && (
                <div className="absolute bottom-full left-0 z-50 mb-1 min-w-[230px] rounded-lg border border-border bg-card py-1 shadow-lg">
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Herramientas
                  </div>
                  {TOOLS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => runTool(t.prompt)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary"
                    >
                      <t.Icon className="h-4 w-4 shrink-0 text-accent" />
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={toggleWebSearch}
              aria-pressed={webSearchOn}
              disabled={disabled}
              title="Buscar en la web"
              className={cn(
                "flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                webSearchOn
                  ? "border-accent/40 bg-accent/[0.06] text-accent"
                  : "border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <Globe className="h-4 w-4" strokeWidth={2.25} />
              <span className="hidden sm:inline">Web</span>
            </button>

            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Attach a PDF"
              disabled={disabled}
            >
              <Paperclip className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              className={cn(
                "ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-all duration-200",
                canSend
                  ? "bg-accent text-accent-foreground shadow-sm hover:opacity-90"
                  : "bg-secondary text-muted-foreground/70",
              )}
              aria-label="Enviar mensaje"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex h-4 items-center justify-end px-1">
        {value.length === 0 && !disabled && (
          <p className="hidden text-[11px] text-muted-foreground sm:block">
            Press{" "}
            <kbd className="rounded border border-border bg-secondary px-1 font-mono text-[10px]">
              Enter
            </kbd>{" "}
            to send
          </p>
        )}
      </div>
    </div>
  )
}
