"use client"

import { ThemeProvider } from "next-themes"
import { Toaster } from "sonner"
import { UserProvider } from "@/context/UserContext"
import { SyllabusProvider } from "@/context/SyllabusContext"
import { AuthModalProvider } from "@/context/AuthModalContext"
import { BienvenidaGate } from "@/components/bienvenida/bienvenida-gate"

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      forcedTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      <UserProvider>
        <SyllabusProvider>
          <AuthModalProvider>
            {children}
            <BienvenidaGate />
            {/* Renders all sonner toasts (upload progress, success/error). Without
                this, toast() calls across the app do nothing. */}
            <Toaster position="top-center" richColors closeButton theme="dark" />
          </AuthModalProvider>
        </SyllabusProvider>
      </UserProvider>
    </ThemeProvider>
  )
}
