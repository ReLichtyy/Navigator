"use client"

/**
 * Promise-based confirmation dialog — the in-app replacement for the browser's
 * native `confirm()`. Usage:
 *
 *   const { confirm, confirmDialog } = useConfirm()
 *   ...
 *   if (await confirm({ title: "¿Eliminar?", destructive: true })) { ... }
 *   ...
 *   return <>{...page}{confirmDialog}</>
 *
 * `confirm` resolves `true` on the confirm button, `false` on cancel, Escape,
 * or clicking outside. Sequential awaits (e.g. one confirm per file in a loop)
 * work naturally: each call re-opens the dialog with its own options.
 */

import { useCallback, useRef, useState, type ReactNode } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

export interface ConfirmOptions {
  title: string
  description?: string
  /** Label for the confirm button (default "Confirmar"). */
  confirmLabel?: string
  /** Label for the cancel button (default "Cancelar"). */
  cancelLabel?: string
  /** Style the confirm button as a destructive action. */
  destructive?: boolean
}

export function useConfirm(): {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  confirmDialog: ReactNode
} {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const confirm = useCallback((o: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      // A confirm opened over a pending one settles the previous as cancelled.
      resolver.current?.(false)
      resolver.current = resolve
      setOpts(o)
    })
  }, [])

  const settle = (ok: boolean) => {
    resolver.current?.(ok)
    resolver.current = null
    setOpts(null)
  }

  const confirmDialog = (
    <Dialog open={!!opts} onOpenChange={(open) => !open && settle(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{opts?.title}</DialogTitle>
          {opts?.description && <DialogDescription>{opts.description}</DialogDescription>}
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => settle(false)}>
            {opts?.cancelLabel ?? "Cancelar"}
          </Button>
          <Button
            autoFocus
            variant={opts?.destructive ? "destructive" : "accent"}
            onClick={() => settle(true)}
          >
            {opts?.confirmLabel ?? "Confirmar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )

  return { confirm, confirmDialog }
}
