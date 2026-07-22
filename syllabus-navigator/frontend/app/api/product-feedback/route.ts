import { NextResponse } from "next/server"
import { ProductFeedbackSchema } from "@/lib/server/validators/api.schemas"
import {
  ApiErrorResponse,
  requireProductFeedbackIdentity,
  requireProductFeedbackRateLimit,
} from "@/lib/server/utils/auth-helpers"
import {
  ProductFeedbackConflictError,
  submitProductFeedback,
} from "@/lib/server/services/product-feedback.service"
import { logError, logInfo } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const identity = await requireProductFeedbackIdentity()
    await requireProductFeedbackRateLimit(identity.userId)

    const body = await request.json().catch(() => null)
    const parsed = ProductFeedbackSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos de feedback inválidos." }, { status: 400 })
    }

    const result = await submitProductFeedback(
      { userId: identity.userId, personName: identity.personName },
      parsed.data,
    )
    const status = result.feedback.syncStatus === "synced" ? 201 : 202

    logInfo("product_feedback.accepted", {
      userId: identity.userId,
      feedbackId: result.feedback.id,
      syncStatus: result.feedback.syncStatus,
    })
    return NextResponse.json(result, { status })
  } catch (error) {
    if (error instanceof ApiErrorResponse) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof ProductFeedbackConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }

    logError("api.product_feedback.error", {
      errorType: error instanceof Error ? error.name : "unknown",
    })
    return NextResponse.json({ error: "No se pudo guardar el feedback." }, { status: 500 })
  }
}
