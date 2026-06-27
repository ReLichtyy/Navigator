"use client"

/**
 * bienvenida-gate.tsx — shows the welcome overlay once, right after sign-up or the
 * first login. Completion is stored in Clerk `unsafeMetadata.onboardingCompleted`,
 * so an already-onboarded user who is "just logged in" never sees it again.
 */

import { useUser } from "@clerk/nextjs"
import { useState } from "react"
import { Bienvenida } from "./bienvenida"

export function BienvenidaGate() {
  const { isLoaded, isSignedIn, user } = useUser()
  const [dismissed, setDismissed] = useState(false)

  if (!isLoaded || !isSignedIn || !user) return null
  if (dismissed) return null
  if (user.unsafeMetadata?.onboardingCompleted === true) return null

  const finish = () => {
    setDismissed(true) // hide immediately; persist in the background
    user
      .update({ unsafeMetadata: { ...user.unsafeMetadata, onboardingCompleted: true } })
      .catch(() => {})
  }

  return <Bienvenida onFinish={finish} />
}
