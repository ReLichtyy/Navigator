"use client"

import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"

export function GuestBanner() {
  const { role } = useUser()
  const { openAuthModal } = useAuthModal()

  if (role !== "guest") return null

  return (
    <div className="bg-accent/10 px-4 py-2 text-center text-sm text-accent-foreground border-b border-accent/20">
      You are using Navigator in <strong>Guest Mode</strong>. Your data is temporary.{" "}
      <button onClick={() => openAuthModal("signup")} className="font-semibold underline hover:text-accent">
        Create an account
      </button>{" "}
      to save your progress and upload PDFs.
    </div>
  )
}
