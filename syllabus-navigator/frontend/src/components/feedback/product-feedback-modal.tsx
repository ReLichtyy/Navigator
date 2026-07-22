"use client"

import { useId, useRef, useState, type FormEvent } from "react"
import { LoaderCircle, UserRound } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { submitProductFeedback, ApiError } from "@/lib/api"
import { useUser } from "@/context/UserContext"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  PRODUCT_FEEDBACK_CATEGORIES,
  PRODUCT_FEEDBACK_DESCRIPTION_MAX,
  isProductFeedbackCategory,
  resolveProductFeedbackRequestId,
  validateProductFeedbackDraft,
  type ProductFeedbackCategory,
  type ProductFeedbackDraftErrors,
} from "@/lib/ui/product-feedback"

interface ProductFeedbackModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  contentId: string
  returnFocusId: string
}

const CATEGORY_TRANSLATION_KEYS: Record<ProductFeedbackCategory, string> = {
  Error: "categories.error",
  Sugerencia: "categories.suggestion",
  Usabilidad: "categories.usability",
  Contenido: "categories.content",
  Otro: "categories.other",
}

export function ProductFeedbackModal({
  open,
  onOpenChange,
  contentId,
  returnFocusId,
}: ProductFeedbackModalProps) {
  const t = useTranslations("feedback")
  const { displayName, avatarUrl } = useUser()
  const categoryId = useId()
  const descriptionId = useId()
  const descriptionHelpId = useId()
  const [category, setCategory] = useState<ProductFeedbackCategory | "">("")
  const [description, setDescription] = useState("")
  const [errors, setErrors] = useState<ProductFeedbackDraftErrors>({})
  const clientRequestIdRef = useRef("")
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const resetDraft = () => {
    setCategory("")
    setDescription("")
    setErrors({})
    clientRequestIdRef.current = ""
    setSubmitError(null)
  }

  const handleCancel = () => {
    resetDraft()
    onOpenChange(false)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextErrors = validateProductFeedbackDraft({ category, description })
    setErrors(nextErrors)
    setSubmitError(null)
    if (Object.keys(nextErrors).length > 0 || !isProductFeedbackCategory(category)) return

    const requestId = resolveProductFeedbackRequestId(clientRequestIdRef.current)
    clientRequestIdRef.current = requestId
    setSubmitting(true)

    try {
      const receipt = await submitProductFeedback({
        category,
        description: description.trim(),
        clientRequestId: requestId,
      })
      toast.success(
        receipt.feedback.syncStatus === "synced" ? t("successSynced") : t("successPending"),
      )
      resetDraft()
      onOpenChange(false)
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 429 ? t("rateLimited") : t("error")
      setSubmitError(message)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  const categoryError = errors.category ? t("categoryRequired") : undefined
  const descriptionError = errors.description
    ? t(errors.description === "too_long" ? "descriptionTooLong" : "descriptionRequired", {
        max: PRODUCT_FEEDBACK_DESCRIPTION_MAX,
      })
    : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        id={contentId}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-[#c084fc]/20 sm:max-w-[520px]"
        closeLabel={t("close")}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          document.getElementById(returnFocusId)?.focus()
        }}
      >
        <DialogHeader className="pr-8">
          <DialogTitle>{t("modalTitle")}</DialogTitle>
          <DialogDescription>{t("modalDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-secondary/35 px-3.5 py-3">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="size-9 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#a855f7]/15 text-[#7e22ce] dark:text-[#c084fc]">
              <UserRound className="size-4" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{t("personLabel")}</p>
            <p className="truncate text-sm font-semibold text-foreground">
              {displayName?.trim() || t("personFallback")}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-5" noValidate>
          <div className="grid gap-2">
            <Label htmlFor={categoryId}>{t("categoryLabel")}</Label>
            <Select
              name="category"
              value={category}
              onValueChange={(value) => {
                if (!isProductFeedbackCategory(value)) return
                setCategory(value)
                clientRequestIdRef.current = ""
                setSubmitError(null)
                setErrors((current) => ({ ...current, category: undefined }))
              }}
              disabled={submitting}
            >
              <SelectTrigger
                id={categoryId}
                aria-invalid={Boolean(categoryError)}
                aria-required="true"
                aria-describedby={categoryError ? `${categoryId}-error` : undefined}
              >
                <SelectValue placeholder={t("categoryPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {PRODUCT_FEEDBACK_CATEGORIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(CATEGORY_TRANSLATION_KEYS[value])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {categoryError && (
              <p id={`${categoryId}-error`} role="alert" className="text-xs text-destructive">
                {categoryError}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={descriptionId}>{t("descriptionLabel")}</Label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {t("characterCount", {
                  count: description.length,
                  max: PRODUCT_FEEDBACK_DESCRIPTION_MAX,
                })}
              </span>
            </div>
            <Textarea
              id={descriptionId}
              name="description"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value)
                clientRequestIdRef.current = ""
                setSubmitError(null)
                setErrors((current) => ({ ...current, description: undefined }))
              }}
              placeholder={t("descriptionPlaceholder")}
              maxLength={PRODUCT_FEEDBACK_DESCRIPTION_MAX}
              rows={6}
              disabled={submitting}
              required
              aria-invalid={Boolean(descriptionError)}
              aria-describedby={descriptionError ? `${descriptionId}-error` : descriptionHelpId}
              className="min-h-36 resize-y"
            />
            {descriptionError ? (
              <p id={`${descriptionId}-error`} role="alert" className="text-xs text-destructive">
                {descriptionError}
              </p>
            ) : (
              <p id={descriptionHelpId} className="text-xs text-muted-foreground">
                {t("descriptionHelp")}
              </p>
            )}
          </div>

          {submitError && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {submitError}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={handleCancel} disabled={submitting}>
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className="bg-[#7e22ce] text-white hover:bg-[#6b21a8] focus-visible:ring-[#a855f7]/60"
            >
              {submitting && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
              {t(submitting ? "submitting" : "submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
