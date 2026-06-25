"use client"

import { useCallback } from "react"
import { useRouter } from "next/navigation"
import { useSyllabus } from "@/context/SyllabusContext"

/**
 * Returns a function that sends a snippet of text to the chat: it stashes a
 * pending query (consumed by ChatContext on mount) and navigates to `/`.
 * Used by the mind map and the study views so a student can highlight any
 * term/topic and get an explanation in context.
 *
 * @param context short phrase describing where the text came from, woven into
 *   the prompt (e.g. "el mapa mental del curso", "tu material de estudio").
 */
export function useAskInChat(context = "tu material de estudio") {
  const { setPendingQuery } = useSyllabus()
  const router = useRouter()
  return useCallback(
    (text: string) => {
      const clean = text.trim()
      if (!clean) return
      setPendingQuery(`Sobre ${context}, explícame con detalle: "${clean}"`)
      router.push("/")
    },
    [context, setPendingQuery, router],
  )
}
