"use client"

import { ThemeProvider } from "next-themes"
import { UserProvider } from "@/context/UserContext"
import { SyllabusProvider } from "@/context/SyllabusContext"
import { AuthModalProvider } from "@/context/AuthModalContext"

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
          <AuthModalProvider>{children}</AuthModalProvider>
        </SyllabusProvider>
      </UserProvider>
    </ThemeProvider>
  )
}
