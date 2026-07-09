"use client"

/**
 * bienvenida-gate.tsx — shows the welcome overlay once, right after sign-up or the
 * first login. Completion is stored in Clerk `unsafeMetadata.onboardingCompleted`,
 * so an already-onboarded user who is "just logged in" never sees it again.
 */

import { useUser } from "@clerk/nextjs"
import { useState } from "react"
import { useBienvenida } from "@/context/BienvenidaContext"
import { Bienvenida } from "./bienvenida"

export function BienvenidaGate() {
  const { isLoaded, isSignedIn, user } = useUser()
  const { forceOpen, closeBienvenida } = useBienvenida()
  const [dismissed, setDismissed] = useState(false)

  if (!isLoaded || !isSignedIn || !user) return null

  const onboarded = user.unsafeMetadata?.onboardingCompleted === true
  // First-run overlay (once, until finished) OR a manual re-open via the brand icon.
  const showFirstRun = !onboarded && !dismissed
  if (!showFirstRun && !forceOpen) return null

  const finish = () => {
    if (showFirstRun) {
      setDismissed(true) // hide immediately; persist in the background
      user
        .update({ unsafeMetadata: { ...user.unsafeMetadata, onboardingCompleted: true } })
        .catch(() => {})
    }
    if (forceOpen) closeBienvenida()
  }

  return <Bienvenida onFinish={finish} />
}
