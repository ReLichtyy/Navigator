"use client"

import { useState } from "react"
import { MessageCircleMore } from "lucide-react"
import { useTranslations } from "next-intl"
import { usePathname } from "next/navigation"
import { ProductFeedbackModal } from "@/components/feedback/product-feedback-modal"
import { Button } from "@/components/ui/button"
import { useUser } from "@/context/UserContext"
import { shouldShowProductFeedbackLauncher } from "@/lib/ui/product-feedback"

export function ProductFeedbackLauncher() {
  const t = useTranslations("feedback")
  const pathname = usePathname()
  const { status } = useUser()
  const [open, setOpen] = useState(false)
  const dialogId = "product-feedback-dialog"

  if (!shouldShowProductFeedbackLauncher(status, pathname)) return null

  return (
    <>
      <div className="pointer-events-none fixed right-[calc(env(safe-area-inset-right)+0.75rem)] top-[calc(env(safe-area-inset-top)+0.625rem)] z-[41] lg:right-[calc(env(safe-area-inset-right)+1.25rem)]">
        <Button
          id="product-feedback-launcher"
          type="button"
          size="icon-lg"
          onClick={() => setOpen(true)}
          aria-label={t("launcherAria")}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={dialogId}
          title={t("launcher")}
          className="pointer-events-auto w-10 rounded-full border border-[#c084fc]/80 bg-[#7e22ce] text-white shadow-[0_8px_24px_rgba(168,85,247,0.28)] hover:bg-[#6b21a8] focus-visible:ring-[#a855f7]/60 lg:w-auto lg:rounded-full lg:px-4"
        >
          <MessageCircleMore className="size-[18px]" aria-hidden="true" />
          <span className="hidden lg:inline">{t("launcher")}</span>
        </Button>
      </div>
      <ProductFeedbackModal
        open={open}
        onOpenChange={setOpen}
        contentId={dialogId}
        returnFocusId="product-feedback-launcher"
      />
    </>
  )
}
