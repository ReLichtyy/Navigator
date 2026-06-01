"use client"

import { useState } from "react"
import { useUser } from "@/context/UserContext"

export function GuestBanner() {
  const { role } = useUser()
  const [showModal, setShowModal] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (role !== "guest") return null

  const handleUpgrade = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    
    try {
      const res = await fetch("/api/auth/upgrade", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        setError(data.error || "Failed to upgrade account")
      } else {
        // Force a page reload to refresh NextAuth session and context
        window.location.reload()
      }
    } catch {
      setError("An unexpected error occurred.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="bg-accent/10 px-4 py-2 text-center text-sm text-accent-foreground border-b border-accent/20">
        You are using Navigator in <strong>Guest Mode</strong>. Your data is temporary.{" "}
        <button onClick={() => setShowModal(true)} className="font-semibold underline hover:text-accent">
          Create an account
        </button>{" "}
        to save your progress and upload PDFs.
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <h2 className="text-xl font-bold mb-2">Create Account</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Enter your details to save your current chat history permanently.
            </p>

            <form onSubmit={handleUpgrade} className="flex flex-col gap-4">
              {error && (
                <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
                  {error}
                </div>
              )}
              
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-10 rounded-lg border border-border bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                  placeholder="you@example.com"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-10 rounded-lg border border-border bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                  placeholder="Min. 6 characters"
                />
              </div>

              <div className="mt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {loading ? "Upgrading..." : "Save Progress"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
