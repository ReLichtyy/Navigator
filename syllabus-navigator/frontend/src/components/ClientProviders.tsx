"use client"

import { SessionProvider } from "next-auth/react"
import type { Session } from "next-auth"
import { ThemeProvider } from "next-themes"
import { UserProvider } from "@/context/UserContext"
import { SyllabusProvider } from "@/context/SyllabusContext"
import { AuthModalProvider } from "@/context/AuthModalContext"

export default function ClientProviders({ 
  children,
  session 
}: { 
  children: React.ReactNode
  session?: Session | null 
}) {
  return (
    <SessionProvider session={session}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
        <UserProvider>
          <SyllabusProvider>
            <AuthModalProvider>
              {children}
            </AuthModalProvider>
          </SyllabusProvider>
        </UserProvider>
      </ThemeProvider>
    </SessionProvider>
  )
}
