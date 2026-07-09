/**
 * ui/locale.ts — client-side locale application (Configuración → Perfil → Idioma).
 *
 * Mirrors theme.ts: the persisted preference lives in `user_preferences.language`
 * (server) and is mirrored to localStorage("nav-lang") so the app can restore it
 * on the next load before the server round-trip resolves. No [locale] URL segment —
 * language is a per-user preference, not a route.
 */

export type Locale = "es" | "en"

export const LOCALE_STORAGE_KEY = "nav-lang"
export const DEFAULT_LOCALE: Locale = "es"

export function isLocale(v: unknown): v is Locale {
  return v === "es" || v === "en"
}

/** Coerce any server-stored language string to a supported UI locale. */
export function toLocale(v: unknown): Locale {
  return isLocale(v) ? v : DEFAULT_LOCALE
}

/** Persist a locale locally (server PATCH is the caller's job). */
export function storeLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // storage unavailable → locale still applies for this page load
  }
}

/** The locally stored locale (defaults to "es"). */
export function storedLocale(): Locale {
  try {
    return toLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY))
  } catch {
    return DEFAULT_LOCALE
  }
}
