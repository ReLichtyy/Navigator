"use client"

import { useEffect, useState } from "react"
import { useUser } from "@/context/UserContext"
import { getPreferences, getUsage, updatePreferences, UserPreferencesAPI, UsageSummaryAPI } from "@/lib/api"
import { toast } from "sonner"
import Link from "next/link"

export default function SettingsPage() {
  const { displayName, ready } = useUser()
  const [preferences, setPreferences] = useState<UserPreferencesAPI | null>(null)
  const [usage, setUsage] = useState<UsageSummaryAPI | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!ready) return

    Promise.all([
      getPreferences().catch(() => null),
      getUsage().catch(() => null),
    ])
      .then(([prefData, usageData]) => {
        if (prefData?.preferences) setPreferences(prefData.preferences)
        if (usageData?.usage) setUsage(usageData.usage)
      })
      .finally(() => setLoading(false))
  }, [ready])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!preferences) return

    setSaving(true)
    try {
      const data = await updatePreferences({
        defaultProvider: preferences.defaultProvider,
        defaultModel: preferences.defaultModel,
        language: preferences.language,
      })
      setPreferences(data.preferences)
      toast.success("Preferences saved successfully.")
    } catch (err) {
      toast.error("Failed to save preferences.")
    } finally {
      setSaving(false)
    }
  }

  if (!ready || loading) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-background text-foreground">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex h-dvh w-full flex-col bg-background text-foreground overflow-y-auto">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 px-6 py-4 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm font-medium text-muted-foreground hover:text-foreground">
              ← Back to Chat
            </Link>
            <h1 className="text-xl font-semibold">Settings</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-6 pb-12">
        {/* Profile Section */}
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium border-b border-border pb-2">Profile</h2>
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">Name</span>
            <span className="font-medium">{displayName || "User"}</span>
          </div>
        </section>

        {/* Preferences Section */}
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium border-b border-border pb-2">Preferences</h2>
          {preferences ? (
            <form onSubmit={handleSave} className="flex flex-col gap-6">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Default Provider</label>
                <select
                  value={preferences.defaultProvider}
                  onChange={(e) => setPreferences({ ...preferences, defaultProvider: e.target.value })}
                  className="h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                >
                  <option value="openai">OpenAI</option>
                  <option value="openrouter">OpenRouter</option>
                </select>
                <p className="text-xs text-muted-foreground">Select the AI provider to use by default.</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Default Model</label>
                <input
                  type="text"
                  value={preferences.defaultModel}
                  onChange={(e) => setPreferences({ ...preferences, defaultModel: e.target.value })}
                  className="h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                  placeholder="e.g. gpt-4o-mini"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Language</label>
                <select
                  value={preferences.language}
                  onChange={(e) => setPreferences({ ...preferences, language: e.target.value })}
                  className="h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                >
                  <option value="en">English</option>
                  <option value="es">Español</option>
                </select>
              </div>

              <div>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Preferences"}
                </button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">Could not load preferences.</p>
          )}
        </section>

        {/* Usage Section */}
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium border-b border-border pb-2">Usage (Last 30 Days)</h2>
          {usage ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
                <span className="text-xs text-muted-foreground">Requests</span>
                <span className="text-xl font-semibold">{usage.totalRequests}</span>
              </div>
              <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
                <span className="text-xs text-muted-foreground">Tokens</span>
                <span className="text-xl font-semibold">{(usage.totalTokens / 1000).toFixed(1)}k</span>
              </div>
              <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
                <span className="text-xs text-muted-foreground">Est. Cost</span>
                <span className="text-xl font-semibold">${usage.totalCostUsd.toFixed(4)}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Usage data not available.</p>
          )}
        </section>
      </main>
    </div>
  )
}
