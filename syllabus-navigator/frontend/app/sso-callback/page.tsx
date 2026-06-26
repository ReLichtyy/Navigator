"use client"

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs"
import { Loader2 } from "lucide-react"

/** Lands the Google OAuth redirect, completes the Clerk session, then routes home. */
export default function SSOCallbackPage() {
  return (
    <div className="flex h-dvh w-full items-center justify-center bg-[#080A09] text-accent">
      <Loader2 className="h-7 w-7 animate-spin" />
      <AuthenticateWithRedirectCallback signInForceRedirectUrl="/" signUpForceRedirectUrl="/" />
    </div>
  )
}
