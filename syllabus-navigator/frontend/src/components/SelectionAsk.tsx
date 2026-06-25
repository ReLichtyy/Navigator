"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { MessageSquarePlus } from "lucide-react"

interface Props {
  /** Called with the selected text when the user clicks "Preguntar al chat". */
  onAsk: (text: string) => void
  /** When false, selection is ignored (no floating button). Defaults to true. */
  enabled?: boolean
  children: ReactNode
}

/**
 * Wraps content so that selecting any text inside it reveals a floating
 * "Preguntar al chat" button positioned over the selection. Used by the mind
 * map so a student can highlight a topic/term and send it straight to the chat.
 */
export function SelectionAsk({ onAsk, enabled = true, children }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null)

  useEffect(() => {
    if (!enabled) {
      setSel(null)
      return
    }
    const update = () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setSel(null)
        return
      }
      const text = selection.toString().trim()
      const anchor = selection.anchorNode
      // Only react to selections inside this wrapper, of a reasonable length.
      if (!anchor || !wrapRef.current?.contains(anchor) || text.length < 3 || text.length > 240) {
        setSel(null)
        return
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        setSel(null)
        return
      }
      setSel({ text, x: rect.left + rect.width / 2, y: rect.top })
    }
    // Defer so the click that ends a drag-select has settled.
    const onUp = () => setTimeout(update, 0)
    const onScroll = () => setSel(null)
    document.addEventListener("mouseup", onUp)
    document.addEventListener("scroll", onScroll, true)
    return () => {
      document.removeEventListener("mouseup", onUp)
      document.removeEventListener("scroll", onScroll, true)
    }
  }, [enabled])

  return (
    <div ref={wrapRef} className="relative">
      {children}
      {sel && (
        <button
          type="button"
          onMouseDown={(e) => {
            // Keep the selection alive through the click.
            e.preventDefault()
            onAsk(sel.text)
            setSel(null)
            window.getSelection()?.removeAllRanges()
          }}
          style={{
            position: "fixed",
            left: sel.x,
            top: sel.y - 44,
            transform: "translateX(-50%)",
            zIndex: 60,
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-accent-foreground shadow-lg ring-1 ring-black/20 transition-opacity hover:opacity-90"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" /> Preguntar al chat
        </button>
      )}
    </div>
  )
}
