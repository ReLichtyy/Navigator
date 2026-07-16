"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Archive, Loader2 } from "lucide-react"
import { fetchTopicsArchive, type TopicsArchiveCourseAPI } from "@/lib/api"
import { resolveCourseColor } from "@/lib/ui/course-color"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion"

/**
 * "Archivo de temas" — every generated topic the user owns, grouped by course.
 * Read-only chips; a chip deep-links to the course's study area so the student
 * can jump straight from a topic to studying it.
 */
export function TopicsArchive() {
  const [groups, setGroups] = useState<TopicsArchiveCourseAPI[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetchTopicsArchive()
      .then((d) => alive && setGroups(d.courses))
      .catch(() => alive && setGroups([]))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  if (!loading && (!groups || groups.length === 0)) return null

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        <Archive className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Archivo de temas
        </h2>
        <span className="text-xs text-muted-foreground/70">
          · Todos los temas generados por curso
        </span>
      </div>

      {loading ? (
        <div className="flex h-20 items-center justify-center rounded-xl border border-border/50 bg-card">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Accordion type="multiple" className="flex flex-col gap-2">
          {groups!.map((g) => {
            const key = g.course_id ?? "sin-curso"
            const color = g.course_id
              ? resolveCourseColor(g.course_color, g.course_id)
              : undefined
            return (
              <AccordionItem key={key} value={key}>
                <AccordionTrigger>
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground/40"
                    style={color ? { backgroundColor: color } : undefined}
                  />
                  <span className="flex-1 truncate text-sm font-semibold">
                    {g.course_name ?? "Sin curso"}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {g.topics.length} {g.topics.length === 1 ? "tema" : "temas"}
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="flex flex-wrap gap-1.5 px-1 pb-1">
                    {g.topics.map((t) =>
                      g.course_id ? (
                        <Link
                          key={t}
                          href={`/estudio?course=${g.course_id}`}
                          className="rounded-full border border-border/60 bg-secondary/40 px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
                          title={`Estudiar ${g.course_name}: ${t}`}
                        >
                          {t}
                        </Link>
                      ) : (
                        <span
                          key={t}
                          className="rounded-full border border-border/60 bg-secondary/40 px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground"
                        >
                          {t}
                        </span>
                      ),
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      )}
    </section>
  )
}
