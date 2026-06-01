"use client"

import { createContext, useContext, useEffect, useState, ReactNode } from "react"
import { useSession } from "next-auth/react"
import { signOut } from "next-auth/react"

interface UserContextType {
  userId: string | null
  displayName: string | null
  ready: boolean
  resetIdentity: () => void
  setDisplayName: (name: string) => void
}

const UserContext = createContext<UserContextType>({
  userId: null,
  displayName: null,
  ready: false,
  resetIdentity: () => {},
  setDisplayName: () => {},
})

export function UserProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession()
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

  return (
    <UserContext.Provider
      value={{
        userId: session?.user?.id ?? null,
        displayName,
        ready: status !== "loading",
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
