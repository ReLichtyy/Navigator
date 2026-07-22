import { describe, expect, it } from "vitest"
import { ProductFeedbackSchema } from "@/lib/server/validators/api.schemas"
import {
  PRODUCT_FEEDBACK_CATEGORIES,
  PRODUCT_FEEDBACK_DESCRIPTION_MAX,
  shouldShowProductFeedbackLauncher,
  validateProductFeedbackDraft,
} from "@/lib/ui/product-feedback"

const requestId = "6ac99542-a52e-40d0-ab67-29a4b16db6db"

describe("ProductFeedbackSchema", () => {
  it("accepts the five supported categories and trims the description", () => {
    for (const category of PRODUCT_FEEDBACK_CATEGORIES) {
      const parsed = ProductFeedbackSchema.parse({
        category,
        description: "  Una observación útil.  ",
        clientRequestId: requestId,
      })
      expect(parsed.description).toBe("Una observación útil.")
    }
  })

  it("rejects unknown categories, empty descriptions and invalid request ids", () => {
    expect(
      ProductFeedbackSchema.safeParse({
        category: "Seguridad",
        description: "x",
        clientRequestId: requestId,
      }).success,
    ).toBe(false)
    expect(
      ProductFeedbackSchema.safeParse({
        category: "Error",
        description: "   ",
        clientRequestId: requestId,
      }).success,
    ).toBe(false)
    expect(
      ProductFeedbackSchema.safeParse({
        category: "Error",
        description: "x",
        clientRequestId: "not-a-uuid",
      }).success,
    ).toBe(false)
  })

  it("rejects descriptions over Notion's text limit and identity fields from the client", () => {
    expect(
      ProductFeedbackSchema.safeParse({
        category: "Contenido",
        description: "x".repeat(PRODUCT_FEEDBACK_DESCRIPTION_MAX + 1),
        clientRequestId: requestId,
      }).success,
    ).toBe(false)
    expect(
      ProductFeedbackSchema.safeParse({
        category: "Contenido",
        description: "x",
        clientRequestId: requestId,
        personName: "Nombre falsificado",
      }).success,
    ).toBe(false)
  })
})

describe("product feedback UI rules", () => {
  it("returns field error codes without duplicating server messages", () => {
    expect(validateProductFeedbackDraft({ category: "", description: "" })).toEqual({
      category: "required",
      description: "required",
    })
    expect(
      validateProductFeedbackDraft({
        category: "Error",
        description: "x".repeat(PRODUCT_FEEDBACK_DESCRIPTION_MAX + 1),
      }),
    ).toEqual({ description: "too_long" })
    expect(
      validateProductFeedbackDraft({ category: "Sugerencia", description: "  Bien  " }),
    ).toEqual({})
  })

  it("shows the launcher only to authenticated users outside auth routes", () => {
    expect(shouldShowProductFeedbackLauncher("authenticated", "/knowledge")).toBe(true)
    expect(shouldShowProductFeedbackLauncher("authenticated", "/estudio")).toBe(true)
    expect(shouldShowProductFeedbackLauncher("anonymous", "/knowledge")).toBe(false)
    expect(shouldShowProductFeedbackLauncher("loading", "/")).toBe(false)
    expect(shouldShowProductFeedbackLauncher("authenticated", "/sign-in")).toBe(false)
    expect(shouldShowProductFeedbackLauncher("authenticated", "/sign-up/start")).toBe(false)
    expect(shouldShowProductFeedbackLauncher("authenticated", "/sso-callback")).toBe(false)
  })
})
