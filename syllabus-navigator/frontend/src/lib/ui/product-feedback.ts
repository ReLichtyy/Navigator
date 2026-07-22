export const PRODUCT_FEEDBACK_CATEGORIES = [
  "Error",
  "Sugerencia",
  "Usabilidad",
  "Contenido",
  "Otro",
] as const

export type ProductFeedbackCategory = (typeof PRODUCT_FEEDBACK_CATEGORIES)[number]

export const PRODUCT_FEEDBACK_DESCRIPTION_MAX = 2_000

export type ProductFeedbackDraftErrorCode = "required" | "too_long"

export interface ProductFeedbackDraftErrors {
  category?: ProductFeedbackDraftErrorCode
  description?: ProductFeedbackDraftErrorCode
}

export function isProductFeedbackCategory(value: string): value is ProductFeedbackCategory {
  return PRODUCT_FEEDBACK_CATEGORIES.includes(value as ProductFeedbackCategory)
}

export function validateProductFeedbackDraft(input: {
  category: string
  description: string
}): ProductFeedbackDraftErrors {
  const errors: ProductFeedbackDraftErrors = {}
  if (!isProductFeedbackCategory(input.category)) errors.category = "required"

  const description = input.description.trim()
  if (!description) errors.description = "required"
  else if (description.length > PRODUCT_FEEDBACK_DESCRIPTION_MAX) {
    errors.description = "too_long"
  }

  return errors
}

export function resolveProductFeedbackRequestId(
  currentRequestId: string,
  createRequestId: () => string = () => crypto.randomUUID(),
): string {
  return currentRequestId || createRequestId()
}

const AUTH_ROUTE_PREFIXES = ["/sign-in", "/sign-up", "/sso-callback"]

export function shouldShowProductFeedbackLauncher(status: string, pathname: string): boolean {
  return (
    status === "authenticated" &&
    !AUTH_ROUTE_PREFIXES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
  )
}
