"use client"

import { createContext, useContext, ReactNode } from "react"
import { useRouter } from "next/navigation"

type AuthModalView = "welcome" | "login" | "signup"

interface AuthModalContextType {
  isOpen: boolean
  openAuthModal: (view?: AuthModalView) => void
  closeAuthModal: () => void
}

const AuthModalContext = createContext<AuthModalContextType>({
  isOpen: false,
  openAuthModal: () => {},
  closeAuthModal: () => {},
})

/**
 * Routes auth requests to our own custom pages instead of Clerk's hosted modals.
 * "signup" opens the sign-up page; "login"/"welcome" land on the custom sign-in
 * design (which itself links to sign-up).
 */
export function AuthModalProvider({ children }: { children: ReactNode }) {
  const router = useRouter()

  const openAuthModal = (view: AuthModalView = "welcome") => {
    router.push(view === "signup" ? "/sign-up" : "/sign-in")
  }

  return (
    <AuthModalContext.Provider value={{ isOpen: false, openAuthModal, closeAuthModal: () => {} }}>
      {children}
    </AuthModalContext.Provider>
  )
}

export function useAuthModal() {
  return useContext(AuthModalContext)
}
