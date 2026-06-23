"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { GoogleButton } from "@/components/auth/google-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [isGuestLoading, setIsGuestLoading] = useState(false)

  const handleGuest = async () => {
    setError(null)
    setIsGuestLoading(true)
    try {
      const result = await signIn("credentials", {
        isGuest: "true",
        redirect: false,
      })

      if (result?.error) {
        setError("Failed to create guest session.")
      } else {
        router.push("/")
        router.refresh()
      }
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setIsGuestLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
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
        setError("Invalid email or password.")
      } else {
        router.push("/")
        router.refresh()
      }
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-border/40 bg-card/50 p-8 shadow-xl backdrop-blur-sm sm:p-10">
        {/* Logo & Header */}
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
            <h1 className="text-2xl font-bold tracking-tighter text-accent">N</h1>
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            Welcome back
          </h2>
          <p className="text-sm text-muted-foreground">
            Sign in to your account or continue as guest
          </p>
        </div>

        <div className="mt-8 space-y-6">
          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            <Button
              type="submit"
              variant="accent"
              disabled={loading || isGuestLoading}
              className="mt-2 w-full"
            >
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>

          <div className="relative my-6">
            <Separator />
            <div className="absolute inset-0 flex justify-center text-xs uppercase -top-2">
              <span className="bg-card px-2 text-muted-foreground">Or</span>
            </div>
          </div>

          {/* Google OAuth */}
          <GoogleButton callbackUrl="/" disabled={loading || isGuestLoading} />

          {/* Guest Mode */}
          <div className="flex flex-col gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleGuest}
              disabled={loading || isGuestLoading}
              className="w-full bg-secondary/50"
            >
              {isGuestLoading ? "Configurando..." : "Probar Navigator"}
            </Button>
            <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
              Guest sessions are limited to 3 chats. Upgrade to unlock full access.
            </p>
          </div>
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="font-semibold text-accent transition-colors hover:text-accent/80 hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
