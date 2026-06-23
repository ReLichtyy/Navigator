"use client"

import { useEffect, useState } from "react"
import { useUser } from "@/context/UserContext"
import { getPreferences, getUsage, updatePreferences, UserPreferencesAPI, UsageSummaryAPI } from "@/lib/api"
import { toast } from "sonner"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
              <Link href="/">← Back to Chat</Link>
            </Button>
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
                <Label htmlFor="provider">Default Provider</Label>
                <Select
                  value={preferences.defaultProvider}
                  onValueChange={(v) => setPreferences({ ...preferences, defaultProvider: v })}
                >
                  <SelectTrigger id="provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="openrouter">OpenRouter</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Select the AI provider to use by default.</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="model">Default Model</Label>
                <Input
                  id="model"
                  type="text"
                  value={preferences.defaultModel}
                  onChange={(e) => setPreferences({ ...preferences, defaultModel: e.target.value })}
                  className="bg-card"
                  placeholder="e.g. gpt-4o-mini"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="language">Language</Label>
                <Select
                  value={preferences.language}
                  onValueChange={(v) => setPreferences({ ...preferences, language: v })}
                >
                  <SelectTrigger id="language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="es">Español</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Button type="submit" variant="accent" disabled={saving}>
                  {saving ? "Saving..." : "Save Preferences"}
                </Button>
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
              <Card className="gap-1 p-4">
                <span className="text-xs text-muted-foreground">Requests</span>
                <span className="text-xl font-semibold">{usage.totalRequests}</span>
              </Card>
              <Card className="gap-1 p-4">
                <span className="text-xs text-muted-foreground">Tokens</span>
                <span className="text-xl font-semibold">{(usage.totalTokens / 1000).toFixed(1)}k</span>
              </Card>
              <Card className="gap-1 p-4">
                <span className="text-xs text-muted-foreground">Est. Cost</span>
                <span className="text-xl font-semibold">${usage.totalCostUsd.toFixed(4)}</span>
              </Card>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Usage data not available.</p>
          )}
        </section>
      </main>
    </div>
  )
}
