"use client"

import { createContext, useContext, useEffect, useState, ReactNode } from "react"
import { useUser as useClerkUser, useClerk } from "@clerk/nextjs"

interface UserContextType {
  userId: string | null
  displayName: string | null
  role: string | null
  ready: boolean
  // "guest" kept in the union for backwards-compat with older callers; never emitted under Clerk.
  status: "anonymous" | "guest" | "authenticated" | "loading"
  resetIdentity: () => void
  setDisplayName: (name: string) => void
}

const UserContext = createContext<UserContextType>({
  userId: null,
  displayName: null,
  role: null,
  ready: false,
  status: "loading",
  resetIdentity: () => {},
  setDisplayName: () => {},
})

export function UserProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, user } = useClerkUser()
  const { signOut } = useClerk()
  const [displayName, setDisplayNameState] = useState<string | null>(null)

  useEffect(() => {
    const name =
      user?.fullName ?? user?.firstName ?? user?.primaryEmailAddress?.emailAddress ?? null
    if (name) setDisplayNameState(name)
  }, [user])

  const setDisplayName = (name: string) => setDisplayNameState(name)

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
        resetIdentity,
        setDisplayName,
      }}
    >
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  return useContext(UserContext)
}
