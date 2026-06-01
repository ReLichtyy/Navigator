"use client"

import { createContext, useContext, useEffect, useState, ReactNode } from "react"
import { useSession } from "next-auth/react"
import { signOut } from "next-auth/react"

interface UserContextType {
  userId: string | null
  displayName: string | null
  role: string | null
  ready: boolean
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
  const { data: session, status: authStatus } = useSession()
  const [displayName, setDisplayNameState] = useState<string | null>(null)

  useEffect(() => {
    if (session?.user?.name) {
      setDisplayNameState(session.user.name)
    }
  }, [session])

  const setDisplayName = (name: string) => {
    setDisplayNameState(name)
    // Note: To persist this to the DB, you would add an API route.
  }

  const resetIdentity = () => {
    signOut({ callbackUrl: "/login" })
  }

  let derivedStatus: "anonymous" | "guest" | "authenticated" | "loading" = "loading"
  if (authStatus === "loading") {
    derivedStatus = "loading"
  } else if (authStatus === "authenticated" && session?.user?.role === "guest") {
    derivedStatus = "guest"
  } else if (authStatus === "authenticated") {
    derivedStatus = "authenticated"
  } else {
    derivedStatus = "anonymous"
  }

  return (
    <UserContext.Provider
      value={{
        userId: session?.user?.id ?? null,
        displayName,
        role: session?.user?.role ?? null,
        ready: authStatus !== "loading",
        status: derivedStatus,
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
