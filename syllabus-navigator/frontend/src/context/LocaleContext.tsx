"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { NextIntlClientProvider } from "next-intl"
import esMessages from "@/messages/es.json"
import enMessages from "@/messages/en.json"
import { DEFAULT_LOCALE, storeLocale, storedLocale, type Locale } from "@/lib/ui/locale"

const MESSAGES: Record<Locale, typeof esMessages> = { es: esMessages, en: enMessages }

interface LocaleState {
  locale: Locale
  /** Apply + persist locally (server PATCH — Configuración → Guardar — is the caller's job). */
  setLocale: (locale: Locale) => void
}

const LocaleUpdateContext = createContext<LocaleState | undefined>(undefined)

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // Always start at DEFAULT_LOCALE so server/client hydration match (SSR has no
  // localStorage). The real stored locale (if any) hydrates one tick later,
  // same tradeoff as the theme anti-FOUC script but for text instead of CSS.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE)

  useEffect(() => {
    const stored = storedLocale()
    if (stored !== DEFAULT_LOCALE) setLocaleState(stored)
  }, [])

  const setLocale = useCallback((next: Locale) => {
    storeLocale(next)
    setLocaleState(next)
  }, [])

  return (
    <LocaleUpdateContext.Provider value={{ locale, setLocale }}>
      {/* Fixed timeZone (not the browser's) so SSR and client format dates
          identically — avoids next-intl's ENVIRONMENT_FALLBACK warning/mismatch.
          Revisit if the app ever needs to show times in the student's own zone. */}
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="UTC">
        {children}
      </NextIntlClientProvider>
    </LocaleUpdateContext.Provider>
  )
}

/** Read/set the active UI locale (distinct from next-intl's own useLocale — this one can change it). */
export function useAppLocale() {
  const ctx = useContext(LocaleUpdateContext)
  if (!ctx) throw new Error("useAppLocale must be used within LocaleProvider")
  return ctx
}
