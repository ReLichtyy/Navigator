"use client"

import { Check } from "lucide-react"
import { COURSE_COLORS } from "@/lib/ui/course-color"

interface Props {
  /** Currently selected hex (from the shared palette). */
  value: string
  onChange: (hex: string) => void
  disabled?: boolean
}

/**
 * Row of course-color swatches. The chosen color is persisted on the course
 * (`user_courses.color`) and is what the Agenda calendar paints its dots with.
 */
export function CourseColorPicker({ value, onChange, disabled }: Props) {
  return (
    <div role="radiogroup" aria-label="Color del curso" className="flex flex-wrap gap-2">
      {COURSE_COLORS.map((c) => {
        const selected = c.hex.toLowerCase() === value.toLowerCase()
        return (
          <button
            key={c.hex}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={c.label}
            title={c.label}
            disabled={disabled}
            onClick={() => onChange(c.hex)}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50 ${
              selected ? "ring-2 ring-foreground/70 ring-offset-2 ring-offset-background" : ""
            }`}
            style={{ background: c.hex }}
          >
            {selected && <Check className="h-3.5 w-3.5 text-[#06140d]" />}
          </button>
        )
      })}
    </div>
  )
}
