import type { MindMapMode } from "@/lib/api"

/** Chip label + hint for each mind-map mode, shared by the radial canvas and the blocks view. */
export const MIND_MODE_OPTIONS: { mode: MindMapMode; label: string; hint: string }[] = [
  { mode: "radial", label: "Radial", hint: "Vista general del curso" },
  { mode: "profundidad", label: "Desarrollo de tema", hint: "Profundiza en un solo tema" },
  { mode: "ideas", label: "Ideas principales", hint: "Lo esencial, sin detalle" },
  { mode: "bloques", label: "Reporte en bloques", hint: "Secciones en orden, de arriba a abajo" },
]
