"use client"

import { ArrowUpRight, Compass, FileText, ThumbsUp, ThumbsDown, Timer } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import type { Message } from "@/components/navigator/types"
import {
  submitFeedback,
  fetchRecommendations,
  fetchAgenda,
  type UpcomingAssessmentAPI,
} from "@/lib/api"
import { Markdown } from "@/components/ui/markdown"

/** Assistant answers mentioning an evaluation → offer a simulacro for the next one. */
const ASSESSMENT_RE = /\b(prueba|examen|qu[ií]z|simulacro|evaluaci[oó]n|parcial|test|corta)\b/i

/** Contextual suggestion: when the latest answer talks about an assessment, link to its simulacro. */
function SimulacroSuggestion({ assessment, syllabusId }: { assessment: UpcomingAssessmentAPI; syllabusId: string }) {
  return (
    <div className="ml-9 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent/[0.06] px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">
          ¿Quieres preparar {assessment.title}
          {assessment.course_name ? ` de ${assessment.course_name}` : ""}?
        </div>
        <div className="text-[11px] text-muted-foreground">Genera un simulacro con el material del curso.</div>
      </div>
      <Link
        href={`/estudio?course=${encodeURIComponent(syllabusId)}&mode=simulacro`}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-bold text-accent-foreground transition-opacity hover:opacity-90"
      >
        <Timer className="h-3.5 w-3.5" /> Crear simulacro
      </Link>
    </div>
  )
}

const prompts = [
  {
    id: "p1",
    title: "¿Cuáles son los temas del curso?",
    description: "Lista los temas principales y su peso en la evaluación.",
  },
  {
    id: "p2",
    title: "¿Cómo se evalúa este curso?",
    description: "Muestra los criterios, porcentajes y fechas de evaluación.",
  },
  {
    id: "p3",
    title: "Resume el sílabo completo",
    description: "Genera un resumen ejecutivo del contenido del curso.",
  },
  {
    id: "p4",
    title: "¿Cuáles son los prerequisitos?",
    description: "Identifica los conocimientos previos necesarios para el curso.",
  },
]

export function ChatThread({ messages, onPrompt }: { messages: Message[]; onPrompt?: (text: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Next upcoming assessment + its course (for the contextual simulacro suggestion).
  const [nextAssessment, setNextAssessment] = useState<{ a: UpcomingAssessmentAPI; syllabusId: string } | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages])

  // Load the nearest assessment once. Fail-silent (anonymous → 401, no schedule → empty).
  useEffect(() => {
    let alive = true
    Promise.all([fetchRecommendations(), fetchAgenda()])
      .then(([plan, agenda]) => {
        if (!alive) return
        const a = plan.upcoming_assessments[0]
        if (!a) return
        const syllabusId = agenda.events.find((e) => e.course_name === a.course_name)?.syllabus_id
        if (syllabusId) setNextAssessment({ a, syllabusId })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // Show the suggestion under the most recent assistant answer that mentions an assessment.
  const lastAssistant = [...messages].reverse().find((m) => m.role !== "user" && !m.pending)
  const showSuggestion =
    !!nextAssessment && !!lastAssistant && ASSESSMENT_RE.test(lastAssistant.content)

  if (messages.length === 0) {
    return (
      <div className="animate-fade-in flex h-full flex-col items-center justify-center gap-6 py-10">
        <div className="flex flex-col items-center text-center">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Start a conversation or upload a document to get started:
          </p>
        </div>

        <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
          {prompts.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPrompt?.(p.title)}
              className="group flex flex-col items-start gap-1.5 rounded-xl border border-border bg-card px-4 py-3.5 text-left transition-colors hover:border-accent/40 hover:bg-secondary/60"
            >
              <div className="flex w-full items-start justify-between gap-2">
                <span className="font-mono text-[13px] font-medium text-foreground">{p.title}</span>
                <ArrowUpRight
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-accent"
                  strokeWidth={2.25}
                />
              </div>
              <span className="text-[12px] leading-relaxed text-muted-foreground">{p.description}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="animate-fade-in h-full overflow-y-auto py-6">
      <div className="flex flex-col gap-5">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {showSuggestion && nextAssessment && (
          <SimulacroSuggestion assessment={nextAssessment.a} syllabusId={nextAssessment.syllabusId} />
        )}
        <div ref={bottomRef} aria-hidden="true" />
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user"

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-sm">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-2.5 group">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent ring-1 ring-accent/20"
      >
        <Compass className="h-3.5 w-3.5" strokeWidth={2.25} />
      </span>

      <div
        className={cn(
          "min-w-0 max-w-[82%] rounded-2xl rounded-tl-md border border-border/60 bg-transparent px-4 py-2.5",
          message.pending && "py-3",
        )}
      >
        {message.pending ? (
          <div className="flex items-center gap-2">
            <span className="flex items-end gap-1" aria-hidden="true">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-dot-pulse" />
              <span
                className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-dot-pulse"
                style={{ animationDelay: "0.15s" }}
              />
              <span
                className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-dot-pulse"
                style={{ animationDelay: "0.3s" }}
              />
            </span>
            <span className="text-[11px] text-muted-foreground">Navigator is thinking...</span>
          </div>
        ) : (
          <>
            <div className="text-sm text-foreground">
              <Markdown content={message.content} />
            </div>
            {message.citations && message.citations.length > 0 && (
              <div className="mt-3 border-t border-border/60 pt-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Sources</p>
                <ul className="flex flex-col gap-1.5">
                  {message.citations.map((c, i) => (
                    <li
                      key={`${c.chunk_id}-${i}`}
                      className="flex gap-2 rounded-md bg-secondary/50 px-2 py-1.5 text-[11px] text-muted-foreground"
                    >
                      <FileText className="h-3 w-3 shrink-0 mt-0.5 text-accent" />
                      <span>
                        {c.page_start != null && <span className="font-medium">p.{c.page_start} · </span>}
                        &ldquo;{c.quote.length > 120 ? `${c.quote.slice(0, 120)}…` : c.quote}&rdquo;
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Feedback Buttons */}
            <div className="mt-2 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={() => {
                  submitFeedback(message.id, "up").catch(() => {})
                  // Optimistic UI state could be added here
                }}
                className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                title="Helpful response"
              >
                <ThumbsUp className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => {
                  submitFeedback(message.id, "down").catch(() => {})
                }}
                className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                title="Not helpful"
              >
                <ThumbsDown className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
