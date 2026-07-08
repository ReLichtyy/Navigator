"use client"

/**
 * billing-section.tsx — Configuración → Plan y facturación (informativo).
 * Sin pagos (no Stripe): dos cards (Gratis / Pro $7), badge del plan actual
 * según el rol, uso del período desde /api/usage y un botón "Mejorar a Pro"
 * deshabilitado ("Próximamente"). Los planes se describen de forma cualitativa
 * — el código no define límites por tier, así que no se inventan cifras.
 */

import { useEffect, useState } from "react"
import { Check, Loader2, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { useUser } from "@/context/UserContext"
import { getUsage, type UsageSummaryAPI } from "@/lib/api"

const sectionTitleCls = "text-[11px] font-bold uppercase tracking-[0.1em] text-[#5BE39A]"

type PlanId = "free" | "pro"

const PLANS: {
  id: PlanId
  name: string
  price: string
  cadence?: string
  features: string[]
}[] = [
  {
    id: "free",
    name: "Gratis",
    price: "$0",
    features: [
      "Sube sílabos y documentos por curso",
      "Chat con citas sobre tu material",
      "Mapa de conocimiento y cronograma",
      "Área de estudio: flashcards y quizzes",
      "Modelo base del asistente",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$7",
    cadence: "/mes",
    features: [
      "Todo lo de Gratis",
      "Más almacenamiento de cursos",
      "Modelos premium del asistente",
      "Prioridad en la generación de material",
      "Soporte prioritario",
    ],
  },
]

/** Map the app role to which plan card is "current". admin counts as Pro. */
function currentPlan(role: string | null): PlanId {
  return role === "pro" || role === "admin" ? "pro" : "free"
}

export function BillingSection() {
  const { role } = useUser()
  const [usage, setUsage] = useState<UsageSummaryAPI | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getUsage()
      .then((data) => setUsage(data?.usage ?? null))
      .catch(() => setUsage(null))
      .finally(() => setLoading(false))
  }, [])

  const active = currentPlan(role)

  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
      {/* planes */}
      <div className="border-b border-white/[0.06] pb-[22px]">
        <div className={cn(sectionTitleCls, "mb-4")}>Tu plan</div>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {PLANS.map((plan) => {
            const isCurrent = plan.id === active
            return (
              <div
                key={plan.id}
                className={cn(
                  "flex flex-col rounded-2xl border p-4",
                  isCurrent
                    ? "border-[rgba(63,191,132,0.5)] bg-[rgba(63,191,132,0.06)]"
                    : "border-white/[0.09] bg-white/[0.02]",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[15px] font-extrabold text-[#F2F6F4]">
                    {plan.id === "pro" && <Sparkles className="h-4 w-4 text-[#5BE39A]" />}
                    {plan.name}
                  </span>
                  {isCurrent && (
                    <span className="rounded-full bg-[rgba(63,191,132,0.16)] px-2.5 py-0.5 text-[10px] font-bold text-[#9FEDC4]">
                      Tu plan actual
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex items-baseline gap-1">
                  <span className="text-[26px] font-extrabold text-[#F4F8F6]">{plan.price}</span>
                  {plan.cadence && (
                    <span className="text-[12.5px] font-semibold text-[#7C8983]">
                      {plan.cadence}
                    </span>
                  )}
                </div>
                <ul className="mt-3 flex flex-1 flex-col gap-2">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[12.5px] text-[#C9D2CD]">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#5BE39A]" strokeWidth={2.4} />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                {plan.id === "pro" &&
                  (isCurrent ? (
                    <div className="mt-4 rounded-[11px] border border-[rgba(63,191,132,0.3)] bg-[rgba(63,191,132,0.08)] py-2.5 text-center text-[12.5px] font-semibold text-[#9FEDC4]">
                      Plan activo
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="mt-4 cursor-not-allowed rounded-[11px] border border-white/10 bg-white/[0.03] py-2.5 text-center text-[12.5px] font-semibold text-[#7C8983]"
                    >
                      Mejorar a Pro · Próximamente
                    </button>
                  ))}
              </div>
            )
          })}
        </div>
      </div>

      {/* uso del período */}
      <div className="py-[22px]">
        <div className={cn(sectionTitleCls, "mb-4")}>Uso (últimos {usage?.periodDays ?? 30} días)</div>
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-[#5BE39A]" />
          </div>
        ) : usage ? (
          <div className="grid grid-cols-3 gap-3">
            <UsageStat label="Solicitudes" value={usage.totalRequests.toLocaleString("es")} />
            <UsageStat label="Tokens" value={`${(usage.totalTokens / 1000).toFixed(1)}k`} />
            <UsageStat label="Costo est." value={`$${usage.totalCostUsd.toFixed(4)}`} />
          </div>
        ) : (
          <div className="text-sm text-[#7C8983]">No hay datos de uso disponibles.</div>
        )}
      </div>
    </div>
  )
}

function UsageStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-3">
      <div className="text-[11px] font-semibold text-[#7C8983]">{label}</div>
      <div className="mt-1 text-lg font-extrabold text-[#F2F6F4]">{value}</div>
    </div>
  )
}
