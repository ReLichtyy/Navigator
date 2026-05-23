"use client"

import { ArrowUpRight, Compass } from "lucide-react"
import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import type { Message } from "@/components/navigator/types"

const prompts = [
  {
    id: "p1",
    title: "Generate a Next.js app",
    description: "with App Router, Tailwind, and a clean dashboard layout.",
  },
  {
    id: "p2",
    title: "Create a golang server",
    description: "with REST endpoints, graceful shutdown, and structured logs.",
  },
]

export function ChatThread({ messages }: { messages: Message[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new message / pending state changes.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="animate-fade-in flex h-full flex-col items-center justify-center gap-6 py-10">
        <div className="flex flex-col items-center text-center">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Click and try one of these prompts:
          </p>
        </div>

        <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
          {prompts.map((p) => (
            <button
              key={p.id}
              type="button"
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
        <div className="max-w-[78%] rounded-2xl rounded-br-md bg-zinc-900 px-4 py-2.5 text-sm leading-relaxed text-zinc-50 shadow-sm">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-2.5">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent ring-1 ring-accent/20"
      >
        <Compass className="h-3.5 w-3.5" strokeWidth={2.25} />
      </span>

      <div
        className={cn(
          "min-w-0 max-w-[82%] rounded-2xl rounded-tl-md border border-zinc-100 bg-transparent px-4 py-2.5",
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
          <p className="text-sm leading-relaxed text-foreground">{message.content}</p>
        )}
      </div>
    </div>
  )
}
