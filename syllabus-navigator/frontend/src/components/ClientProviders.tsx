"use client"

import { ThemeProvider } from "next-themes"
import { Toaster } from "sonner"
import { LocaleProvider } from "@/context/LocaleContext"
import { UserProvider } from "@/context/UserContext"
import { SyllabusProvider } from "@/context/SyllabusContext"
import { AuthModalProvider } from "@/context/AuthModalContext"
import { ChatNavProvider } from "@/context/ChatNavContext"
import { BienvenidaProvider } from "@/context/BienvenidaContext"
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
      {/* Outside UserProvider: the user's saved language pref (once loaded)
          drives the active locale via useAppLocale(). */}
      <LocaleProvider>
        <UserProvider>
          <SyllabusProvider>
            <AuthModalProvider>
              <BienvenidaProvider>
                <ChatNavProvider>{children}</ChatNavProvider>
                <BienvenidaGate />
              </BienvenidaProvider>
              {/* Renders all sonner toasts (upload progress, success/error). Without
                  this, toast() calls across the app do nothing. */}
              <Toaster position="top-center" richColors closeButton theme="dark" />
            </AuthModalProvider>
          </SyllabusProvider>
        </UserProvider>
      </LocaleProvider>
    </ThemeProvider>
  )
}
