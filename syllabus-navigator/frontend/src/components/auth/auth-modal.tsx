"use client"

import { useState, useEffect } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useUser } from "@/context/UserContext"

export type AuthModalView = "welcome" | "login" | "signup"

interface AuthModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialView?: AuthModalView
}

export function AuthModal({ open, onOpenChange, initialView = "welcome" }: AuthModalProps) {
  const router = useRouter()
  const [view, setView] = useState<AuthModalView>(initialView)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [isGuestLoading, setIsGuestLoading] = useState(false)
  const { status } = useUser()

  // Sync initialView when modal opens
  useEffect(() => {
    if (open) {
      setView(initialView)
      setError(null)
    }
  }, [open, initialView])

  const createGuestSession = async () => {
    setError(null)
    setIsGuestLoading(true)
    try {
      const result = await signIn("credentials", {
        isGuest: "true",
        redirect: false,
      })

      if (result?.error) {
        setError("No se pudo iniciar la sesión de invitado.")
      } else {
        onOpenChange(false)
        router.refresh()
      }
    } catch {
      setError("Algo salió mal. Por favor intenta de nuevo.")
    } finally {
      setIsGuestLoading(false)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        setError("Correo o contraseña inválidos.")
      } else {
        onOpenChange(false)
        router.refresh()
      }
    } catch {
      setError("Algo salió mal. Por favor intenta de nuevo.")
    } finally {
      setLoading(false)
    }
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const isUpgrade = status === "guest"
      const endpoint = isUpgrade ? "/api/auth/upgrade" : "/api/auth/signup"
      const method = isUpgrade ? "PUT" : "POST"

      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Fallo al procesar la solicitud.")
        setLoading(false)
        return
      }

      // If it was an upgrade, we should reload the window to completely refresh the session context.
      // NextAuth sometimes caches the JWT on the client side unless we force reload.
      if (isUpgrade) {
        window.location.reload()
        return
      }

      // Auto login after signup for anonymous users
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        setError("Cuenta creada, pero falló el inicio de sesión. Intenta entrar manualmente.")
      } else {
        onOpenChange(false)
        router.refresh()
      }
    } catch {
      setError("Algo salió mal. Por favor intenta de nuevo.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* We use a glassmorphic content style */}
      <DialogContent 
        className="max-w-md border border-border/40 bg-card/60 p-8 shadow-2xl backdrop-blur-xl sm:p-10"
        showCloseButton={view !== "welcome"} // Welcome hides close if we want it to be more prominent, but actually Radix allows clicking outside anyway.
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
            <h1 className="text-2xl font-bold tracking-tighter text-accent">N</h1>
          </div>
          
          <DialogTitle className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            {view === "welcome" && "Welcome to Navigator"}
            {view === "login" && "Welcome back"}
            {view === "signup" && "Create an account"}
          </DialogTitle>
          
          <DialogDescription className="text-sm text-muted-foreground">
            {view === "welcome" && "Sign in or explore as a guest to get started."}
            {view === "login" && "Sign in to your account."}
            {view === "signup" && "Sign up to save your knowledge graph and chats."}
          </DialogDescription>
        </div>

        <div className="mt-6 space-y-6">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {view === "welcome" && (
            <div className="flex flex-col gap-4">
              <button
                type="button"
                onClick={createGuestSession}
                disabled={isGuestLoading}
                className="h-11 w-full rounded-lg bg-accent font-medium text-accent-foreground shadow-sm transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isGuestLoading ? "Configurando..." : "Probar Navigator"}
              </button>
              
              <button
                type="button"
                onClick={() => setView("login")}
                className="h-11 w-full rounded-lg border border-border bg-secondary/50 font-medium text-foreground shadow-sm transition-colors hover:bg-secondary"
              >
                Iniciar sesión
              </button>

              <p className="text-center text-xs leading-relaxed text-muted-foreground mt-2">
                Guest sessions are limited. We recommend signing up for full features.
              </p>
            </div>
          )}

          {view === "login" && (
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground text-left">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="h-10 w-full rounded-lg border border-border/50 bg-background/50 px-3 text-sm text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground text-left">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="h-10 w-full rounded-lg border border-border/50 bg-background/50 px-3 text-sm text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 h-10 w-full rounded-lg bg-accent font-medium text-accent-foreground shadow-sm transition-all hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "Signing in..." : "Sign in"}
              </button>

              <p className="mt-4 text-center text-sm text-muted-foreground">
                Don&apos;t have an account?{" "}
                <button type="button" onClick={() => setView("signup")} className="font-semibold text-accent hover:underline">
                  Sign up
                </button>
              </p>
            </form>
          )}

          {view === "signup" && (
            <form onSubmit={handleSignup} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground text-left">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                  className="h-10 w-full rounded-lg border border-border/50 bg-background/50 px-3 text-sm text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground text-left">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="h-10 w-full rounded-lg border border-border/50 bg-background/50 px-3 text-sm text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground text-left">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="h-10 w-full rounded-lg border border-border/50 bg-background/50 px-3 text-sm text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 h-10 w-full rounded-lg bg-accent font-medium text-accent-foreground shadow-sm transition-all hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "Creating account..." : "Sign up"}
              </button>

              <p className="mt-4 text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <button type="button" onClick={() => setView("login")} className="font-semibold text-accent hover:underline">
                  Sign in
                </button>
              </p>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
