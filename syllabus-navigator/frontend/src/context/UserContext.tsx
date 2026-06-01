"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { setApiUserId } from "@/lib/api"

const USER_ID_KEY = "navigator_user_id"
const DISPLAY_NAME_KEY = "navigator_display_name"

type UserContextValue = {
  userId: string
  displayName: string
  ready: boolean
  setDisplayName: (name: string) => void
  resetIdentity: () => void
}

const UserContext = createContext<UserContextValue | null>(null)

function loadOrCreateUserId(): string {
  let id = localStorage.getItem(USER_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(USER_ID_KEY, id)
  }
  return id
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState("")
  const [displayName, setDisplayNameState] = useState("Local User")
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const id = loadOrCreateUserId()
    const name = localStorage.getItem(DISPLAY_NAME_KEY) || "Local User"
    setUserId(id)
    setDisplayNameState(name)
    setApiUserId(id)
    setReady(true)
  }, [])

  const setDisplayName = useCallback((name: string) => {
    const trimmed = name.trim() || "Local User"
    localStorage.setItem(DISPLAY_NAME_KEY, trimmed)
    setDisplayNameState(trimmed)
  }, [])

  const resetIdentity = useCallback(() => {
    const id = crypto.randomUUID()
    localStorage.setItem(USER_ID_KEY, id)
    localStorage.removeItem(DISPLAY_NAME_KEY)
    setUserId(id)
    setDisplayNameState("Local User")
    setApiUserId(id)
    window.location.reload()
  }, [])

  const value = useMemo(
    () => ({ userId, displayName, ready, setDisplayName, resetIdentity }),
    [userId, displayName, ready, setDisplayName, resetIdentity],
  )

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

export function useUser() {
  const ctx = useContext(UserContext)
  if (!ctx) throw new Error("useUser must be used within UserProvider")
  return ctx
}
