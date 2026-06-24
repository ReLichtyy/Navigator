"use client"

import { createContext, useContext, ReactNode } from "react"
import { useClerk } from "@clerk/nextjs"

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
 * Thin shim over Clerk's hosted modals so existing callers keep using
 * `openAuthModal("login" | "signup")`. "signup"/"welcome" open the sign-up flow,
 * "login" opens sign-in. There is no custom modal anymore.
 */
export function AuthModalProvider({ children }: { children: ReactNode }) {
  const { openSignIn, openSignUp } = useClerk()

  const openAuthModal = (view: AuthModalView = "welcome") => {
    if (view === "login") openSignIn({})
    else openSignUp({})
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
