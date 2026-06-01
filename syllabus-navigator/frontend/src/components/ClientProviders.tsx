"use client"

import { SessionProvider } from "next-auth/react"
import type { Session } from "next-auth"
import { ThemeProvider } from "next-themes"
import { UserProvider } from "@/context/UserContext"
import { SyllabusProvider } from "@/context/SyllabusContext"

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
            {children}
          </SyllabusProvider>
        </UserProvider>
      </ThemeProvider>
    </SessionProvider>
  )
}
