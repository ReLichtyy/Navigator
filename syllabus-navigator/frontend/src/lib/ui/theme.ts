/**
 * ui/theme.ts — client-side theme application (Configuración → Apariencia).
 *
 * The persisted preference lives in `user_preferences.theme` (server) and is
 * mirrored to localStorage("nav-theme") so the inline anti-FOUC script in
 * app/layout.tsx can apply it before hydration. "system" follows
 * prefers-color-scheme live via watchSystemTheme().
 */

export type ThemePref = "dark" | "light" | "system"

export const THEME_STORAGE_KEY = "nav-theme"

export function isThemePref(v: unknown): v is ThemePref {
  return v === "dark" || v === "light" || v === "system"
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
}

/** Toggle the root .dark class for a preference (no persistence). */
export function syncThemeClass(pref: ThemePref): void {
  if (typeof document === "undefined") return
  const dark = pref === "dark" || (pref === "system" && systemPrefersDark())
  document.documentElement.classList.toggle("dark", dark)
}

/** Apply + persist a theme preference locally (server PATCH is the caller's job). */
export function applyTheme(pref: ThemePref): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref)
  } catch {
    // storage unavailable → theme still applies for this page load
  }
  syncThemeClass(pref)
}

/** The locally stored preference (defaults to "dark", the app's original look). */
export function storedTheme(): ThemePref {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePref(v) ? v : "dark"
  } catch {
    return "dark"
  }
}

/** Re-sync when the OS scheme changes while the pref is "system". Returns a cleanup. */
export function watchSystemTheme(): () => void {
  if (typeof window === "undefined") return () => {}
  const mq = window.matchMedia("(prefers-color-scheme: dark)")
  const onChange = () => {
    if (storedTheme() === "system") syncThemeClass("system")
  }
  mq.addEventListener("change", onChange)
  return () => mq.removeEventListener("change", onChange)
}
