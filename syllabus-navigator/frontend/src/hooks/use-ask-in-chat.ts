"use client"

import { useCallback } from "react"
import { useRouter } from "next/navigation"
import { useSyllabus, type PendingAsk } from "@/context/SyllabusContext"

/** Course/doc binding for an ask — routes it to that scope's dedicated chat. */
export type AskTarget = Omit<PendingAsk, "text">

/**
 * Returns a function that sends a snippet of text to the chat: it stashes a
 * pending query (consumed by ChatContext on mount) and navigates to `/`.
 * Used by the mind map and the study views so a student can highlight any
 * term/topic and get an explanation in context.
 *
 * Pass a `target` to bind the question to a course (or document): every ask
 * for the same course lands in ONE dedicated chat, created lazily on the
 * first ask instead of spawning a new chat per question.
 *
 * @param context short phrase describing where the text came from, woven into
 *   the prompt (e.g. "el mapa mental del curso", "tu material de estudio").
 */
export function useAskInChat(context = "tu material de estudio") {
  const { setPendingQuery } = useSyllabus()
  const router = useRouter()
  return useCallback(
    (text: string, target?: AskTarget) => {
      const clean = text.trim()
      if (!clean) return
      setPendingQuery({
        text: `Sobre ${context}, explícame con detalle: "${clean}"`,
        ...target,
      })
      router.push("/")
    },
    [context, setPendingQuery, router],
  )
}
