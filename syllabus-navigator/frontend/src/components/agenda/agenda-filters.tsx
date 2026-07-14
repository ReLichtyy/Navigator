"use client"

import { FileText, X } from "lucide-react"
import type { ScheduleEventAPI } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { meta } from "@/lib/ui/agenda-format"
import {
  buildFacets,
  toggle,
  isFilterActive,
  EMPTY_FILTER,
  type AgendaFilter,
} from "@/lib/ui/agenda-filter"

interface Props {
  /** All dated/undated events extracted from the user's documents (unfiltered). */
  events: ScheduleEventAPI[]
  value: AgendaFilter
  onChange: (next: AgendaFilter) => void
  /** How many events survive the current filter (shown in the summary line). */
  shown: number
}

function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-accent bg-accent/15 text-foreground"
          : "border-border/60 bg-secondary/30 text-muted-foreground hover:border-accent/40 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-20 shrink-0 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}

/**
 * Filter bar over the dates extracted from the syllabi/cronogramas: course,
 * source document, event type. Each facet is OR-within / AND-across; no
 * selection in a facet means "all".
 */
export function AgendaFilters({ events, value, onChange, shown }: Props) {
  const facets = buildFacets(events)
  const active = isFilterActive(value)

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-accent">
          Filtros de fechas detectadas
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {shown} de {events.length} {events.length === 1 ? "fecha" : "fechas"}
          </span>
          {active && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => onChange(EMPTY_FILTER)}
            >
              <X className="h-3 w-3" />
              Limpiar
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2.5">
        {facets.courses.length > 1 && (
          <Row label="Curso">
            {facets.courses.map((f) => (
              <Chip
                key={f.key}
                active={value.courses.includes(f.key)}
                onClick={() => onChange({ ...value, courses: toggle(value.courses, f.key) })}
              >
                <span className="h-2 w-2 flex-none rounded-full" style={{ background: f.color }} />
                <span className="max-w-[180px] truncate">{f.label}</span>
                <span className="text-[10px] opacity-60">{f.count}</span>
              </Chip>
            ))}
          </Row>
        )}

        {facets.docs.length > 1 && (
          <Row label="Documento">
            {facets.docs.map((f) => (
              <Chip
                key={f.key}
                active={value.docs.includes(f.key)}
                onClick={() => onChange({ ...value, docs: toggle(value.docs, f.key) })}
                title={f.label}
              >
                <FileText className="h-3 w-3" />
                <span className="max-w-[180px] truncate">{f.label}</span>
                <span className="text-[10px] opacity-60">{f.count}</span>
              </Chip>
            ))}
          </Row>
        )}

        {facets.types.length > 1 && (
          <Row label="Tipo">
            {facets.types.map((f) => {
              const m = meta(f.key)
              return (
                <Chip
                  key={f.key}
                  active={value.types.includes(f.key)}
                  onClick={() => onChange({ ...value, types: toggle(value.types, f.key) })}
                >
                  <m.Icon className="h-3 w-3" />
                  {m.label}
                  <span className="text-[10px] opacity-60">{f.count}</span>
                </Chip>
              )
            })}
          </Row>
        )}
      </div>
    </section>
  )
}
