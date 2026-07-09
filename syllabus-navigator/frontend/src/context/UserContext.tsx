"use client"

import { createContext, useContext, useEffect, useState, ReactNode } from "react"
import { useUser as useClerkUser, useClerk } from "@clerk/nextjs"
import { getPreferences } from "@/lib/api"
import { applyTheme, isThemePref, watchSystemTheme } from "@/lib/ui/theme"
import { useAppLocale } from "@/context/LocaleContext"
import { isLocale } from "@/lib/ui/locale"

interface UserContextType {
  userId: string | null
  displayName: string | null
  role: string | null
  ready: boolean
  // "guest" kept in the union for backwards-compat with older callers; never emitted under Clerk.
  status: "anonymous" | "guest" | "authenticated" | "loading"
  /** Custom avatar (users.image) when set, else the Clerk/Google photo, else null. */
  avatarUrl: string | null
  resetIdentity: () => void
  setDisplayName: (name: string) => void
  /** Update the custom avatar app-wide (pass null to fall back to the Clerk photo). */
  setAvatarUrl: (url: string | null) => void
}

const UserContext = createContext<UserContextType>({
  userId: null,
  displayName: null,
  role: null,
  ready: false,
  status: "loading",
  avatarUrl: null,
  resetIdentity: () => {},
  setDisplayName: () => {},
  setAvatarUrl: () => {},
})

export function UserProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, user } = useClerkUser()
  const { signOut } = useClerk()
  const { setLocale } = useAppLocale()
  const [displayName, setDisplayNameState] = useState<string | null>(null)
  const [customAvatar, setCustomAvatar] = useState<string | null>(null)

  useEffect(() => {
    const name =
      user?.fullName ?? user?.firstName ?? user?.primaryEmailAddress?.emailAddress ?? null
    if (name) setDisplayNameState(name)
  }, [user])

  // Custom avatar (users.image) + server theme pref — one cheap read on
  // sign-in (server caches prefs). The theme is mirrored to localStorage so the
  // anti-FOUC script in layout.tsx picks it up on the next load.
  useEffect(() => {
    if (!isSignedIn) {
      setCustomAvatar(null)
      return
    }
    getPreferences()
      .then((data) => {
        setCustomAvatar(data?.preferences?.avatarUrl ?? null)
        const theme = data?.preferences?.theme
        if (isThemePref(theme)) applyTheme(theme)
        const language = data?.preferences?.language
        if (isLocale(language)) setLocale(language)
      })
      .catch(() => {})
  }, [isSignedIn, setLocale])

  // "system" theme follows OS scheme changes live.
  useEffect(() => watchSystemTheme(), [])

  const setDisplayName = (name: string) => setDisplayNameState(name)
  const setAvatarUrl = (url: string | null) => setCustomAvatar(url)

  const resetIdentity = () => {
    void signOut({ redirectUrl: "/sign-in" })
  }

  const status: UserContextType["status"] = !isLoaded
    ? "loading"
    : isSignedIn
      ? "authenticated"
      : "anonymous"

  return (
    <UserContext.Provider
      value={{
        userId: user?.id ?? null,
        displayName,
        role: (user?.publicMetadata?.role as string | undefined) ?? (isSignedIn ? "free" : null),
        ready: isLoaded,
        status,
        avatarUrl: customAvatar ?? user?.imageUrl ?? null,
        resetIdentity,
        setDisplayName,
        setAvatarUrl,
      }}
    >
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  return useContext(UserContext)
}
