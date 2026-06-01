"use client"

import { createContext, useContext, useState, ReactNode } from "react"
import { AuthModal } from "@/components/auth/auth-modal"

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

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [view, setView] = useState<AuthModalView>("welcome")

  const openAuthModal = (newView: AuthModalView = "welcome") => {
    setView(newView)
    setIsOpen(true)
  }
  
  const closeAuthModal = () => setIsOpen(false)

  return (
    <AuthModalContext.Provider value={{ isOpen, openAuthModal, closeAuthModal }}>
      {children}
      <AuthModal open={isOpen} onOpenChange={setIsOpen} initialView={view} />
    </AuthModalContext.Provider>
  )
}

export function useAuthModal() {
  return useContext(AuthModalContext)
}
