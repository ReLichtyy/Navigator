"use client"

import { createContext, useCallback, useContext, useState } from "react"

/**
 * Lets any surface (e.g. the Navigator brand icon) re-open the welcome overlay
 * on demand. BienvenidaGate consumes `forceOpen` to show it even when the user
 * has already finished onboarding.
 */
interface BienvenidaState {
  forceOpen: boolean
  openBienvenida: () => void
  closeBienvenida: () => void
}

const BienvenidaContext = createContext<BienvenidaState | undefined>(undefined)

export function BienvenidaProvider({ children }: { children: React.ReactNode }) {
  const [forceOpen, setForceOpen] = useState(false)
  const openBienvenida = useCallback(() => setForceOpen(true), [])
  const closeBienvenida = useCallback(() => setForceOpen(false), [])

  return (
    <BienvenidaContext.Provider value={{ forceOpen, openBienvenida, closeBienvenida }}>
      {children}
    </BienvenidaContext.Provider>
  )
}

export function useBienvenida() {
  const ctx = useContext(BienvenidaContext)
  if (!ctx) throw new Error("useBienvenida must be used within BienvenidaProvider")
  return ctx
}
