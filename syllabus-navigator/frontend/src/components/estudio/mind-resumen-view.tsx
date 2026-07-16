"use client"

/**
 * mind-resumen-view.tsx — the Resumen mode, redesigned to the AreaEstudio.dc
 * "4h" layout: a left "Contenido" table-of-contents rail and a structured body
 * (tema principal → ideas → conceptos → guía → conclusión). Content still comes
 * from the generated `summary` + `studyGuide`; only the presentation changed.
 */

import { RefreshCw, Layers, HelpCircle } from "lucide-react"
import type { StudySetAPI } from "@/lib/api"
import { BackButton, EmptyMode } from "./flashcards-view"

type TocEntry = { id: string; label: string; sub?: boolean }

export function ResumenView({
  courseName,
  summary,
  studyGuide,
  regenerating,
  onRegenerate,
  onFlash,
  onQuiz,
  onBack,
}: {
  courseName: string
  summary: StudySetAPI["summary"]
  studyGuide?: StudySetAPI["studyGuide"]
  regenerating: boolean
  onRegenerate: () => void
  onFlash: () => void
  onQuiz: () => void
  onBack: () => void
}) {
  if (!summary.introduccion && summary.ideasPrincipales.length === 0) {
    return <EmptyMode onBack={onBack} label="No hay resumen para este curso." />
  }

  const hasIdeas = summary.ideasPrincipales.length > 0
  const hasConceptos = summary.conceptos.length > 0
  const hasGuide = !!studyGuide && studyGuide.length > 0
  const hasConclusion = !!summary.conclusion

  // Build the TOC from whatever the summary actually carries.
  const toc: TocEntry[] = [{ id: "tema", label: "1 · Tema principal" }]
  if (hasIdeas) toc.push({ id: "ideas", label: "1.1 Ideas principales", sub: true })
  if (hasConceptos) toc.push({ id: "conceptos", label: "1.2 Conceptos", sub: true })
  if (hasGuide) toc.push({ id: "guia", label: "2 · Guía de estudio" })
  if (hasConclusion) toc.push({ id: "conclusion", label: "3 · Conclusión" })

  const readMin = Math.max(
    1,
    Math.round(
      (summary.ideasPrincipales.join(" ").length + summary.conceptos.map((c) => c.definicion).join(" ").length) /
        900,
    ),
  )

  return (
    <div>
      <BackButton onBack={onBack} />
      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        {/* ── Contenido (TOC) ── */}
        <aside className="flex h-fit flex-col gap-2 lg:sticky lg:top-4">
          <div className="text-[10.5px] font-bold uppercase tracking-widest text-muted-foreground">
            Contenido
          </div>
          <nav className="flex flex-col gap-0.5 text-[12px]">
            {toc.map((t, i) => (
              <a
                key={t.id}
                href={`#res-${t.id}`}
                className={`scroll-mt-4 rounded-lg px-2.5 py-1.5 transition-colors ${
                  i === 0
                    ? "bg-accent/10 font-bold text-accent"
                    : t.sub
                      ? "pl-4 text-muted-foreground hover:text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </a>
            ))}
          </nav>
          <div className="mt-1 rounded-xl border border-border bg-card/50 px-3 py-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
            Generado desde el material del curso · ~{readMin} min de lectura
          </div>
          <div className="mt-1 flex flex-col gap-2">
            <button
              onClick={onRegenerate}
              disabled={regenerating}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? "animate-spin" : ""}`} />
              Regenerar
            </button>
            <button
              onClick={onFlash}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              <Layers className="h-3.5 w-3.5 text-accent" /> Tarjetas
            </button>
            <button
              onClick={onQuiz}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              <HelpCircle className="h-3.5 w-3.5 text-accent" /> Quiz
            </button>
          </div>
        </aside>

        {/* ── Body ── */}
        <div className="max-w-3xl">
          <div id="res-tema" className="scroll-mt-4">
            <div className="text-[11px] font-bold uppercase tracking-widest text-accent">
              Tema principal
            </div>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight">
              {summary.titulo || courseName || "Resumen"}
            </h1>
            {summary.temaPrincipal && (
              <p className="mt-1 text-sm text-muted-foreground">{summary.temaPrincipal}</p>
            )}
            {summary.introduccion && (
              <p className="mt-4 text-[13.5px] leading-relaxed text-foreground/90">
                {summary.introduccion}
              </p>
            )}
          </div>

          {hasIdeas && (
            <div id="res-ideas" className="mt-8 scroll-mt-4">
              <h2 className="text-sm font-extrabold tracking-tight">Ideas principales</h2>
              <div className="mt-3 flex flex-col gap-3">
                {summary.ideasPrincipales.map((idea, i) => (
                  <div key={i} className="flex gap-3.5">
                    <div className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-accent/10 font-mono text-xs font-semibold text-accent">
                      {i + 1}
                    </div>
                    <div className="text-[13.5px] leading-relaxed text-foreground/90">{idea}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasConceptos && (
            <div id="res-conceptos" className="mt-8 scroll-mt-4">
              <h2 className="text-sm font-extrabold tracking-tight">Conceptos importantes</h2>
              <div className="mt-3 flex flex-col gap-2.5">
                {summary.conceptos.map((c, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card/50 p-4">
                    <div className="font-mono text-sm font-bold text-accent">{c.termino}</div>
                    <div className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                      {c.definicion}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasGuide && (
            <div id="res-guia" className="mt-8 scroll-mt-4">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-extrabold tracking-tight">Guía de estudio</h2>
                <span className="text-[11px] text-muted-foreground">ordenada por peso en el examen</span>
              </div>
              <div className="mt-3 flex flex-col gap-2.5">
                {studyGuide!.map((s, i) => (
                  <div key={i} className="rounded-xl border border-accent/15 bg-accent/[0.04] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-bold text-foreground">{s.topic}</span>
                      {s.weight > 0 && (
                        <span className="flex-none rounded-md bg-accent/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-accent">
                          {Math.round(s.weight)}%
                        </span>
                      )}
                    </div>
                    <ul className="mt-2 flex flex-col gap-1">
                      {s.points.map((p, j) => (
                        <li key={j} className="flex gap-2 text-[13px] leading-relaxed text-muted-foreground">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasConclusion && (
            <div id="res-conclusion" className="mt-8 scroll-mt-4 rounded-xl border-l-[3px] border-accent bg-card/40 p-4">
              <div className="text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">
                Conclusión
              </div>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-foreground/90">
                {summary.conclusion}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
