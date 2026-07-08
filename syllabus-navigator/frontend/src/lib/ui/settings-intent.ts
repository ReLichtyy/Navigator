/**
 * ui/settings-intent.ts — one-shot "open the Configuración modal" handoff.
 *
 * The retired /settings route can't open the modal directly (the modal lives in
 * the app shell), so it drops this sessionStorage flag and redirects home; the
 * shell reads + clears it on mount. sessionStorage (not a query param) so it
 * survives the redirect without opting the whole app into dynamic rendering.
 */

export const OPEN_SETTINGS_FLAG = "nav:open-settings"

/** Read-and-clear the flag. Returns true when the modal should auto-open. */
export function consumeOpenSettings(): boolean {
  try {
    if (sessionStorage.getItem(OPEN_SETTINGS_FLAG) === "1") {
      sessionStorage.removeItem(OPEN_SETTINGS_FLAG)
      return true
    }
  } catch {
    // storage unavailable
  }
  return false
}
