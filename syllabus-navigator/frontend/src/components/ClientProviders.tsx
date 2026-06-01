"use client"

import { Toaster } from "sonner"
import { SyllabusProvider } from "@/context/SyllabusContext"
import { UserProvider } from "@/context/UserContext"

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <UserProvider>
      <SyllabusProvider>
        {children}
        <Toaster richColors position="top-center" />
      </SyllabusProvider>
    </UserProvider>
  )
}
