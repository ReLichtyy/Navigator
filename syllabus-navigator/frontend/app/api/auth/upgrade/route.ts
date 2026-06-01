import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { sql } from "@/lib/db"
import { auth } from "@/lib/auth/auth"
import { logError, logInfo } from "@/lib/observability/logger"
import { checkRateLimit } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 6

export async function PUT(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for") ?? "anonymous"
    const rl = await checkRateLimit(ip, "guest")
    if (!rl.success) {
      return NextResponse.json(
        { error: "Too many attempts from this IP. Please try again later." },
        { status: 429, headers: { "Retry-After": Math.ceil((rl.reset - Date.now()) / 1000).toString() } }
      )
    }

    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (session.user.role !== "guest") {
      return NextResponse.json({ error: "You already have a registered account." }, { status: 400 })
    }

    const userId = session.user.id
    const body = await request.json().catch(() => null)

    if (!body || !body.email || !body.password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 },
      )
    }

    const email = String(body.email).toLowerCase().trim()
    const password = String(body.password)

    // Validate email format
    if (!EMAIL_REGEX.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format." },
        { status: 400 },
      )
    }

    // Validate password length
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
        { status: 400 },
      )
    }

    // Check uniqueness
    const existing = await sql`
      SELECT id FROM users WHERE email = ${email} AND id != ${userId}
    `
    if ((existing as { id: string }[]).length > 0) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 },
      )
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12)

    // Upgrade user
    await sql`
      UPDATE users 
      SET email = ${email}, password_hash = ${passwordHash}, role = 'free'
      WHERE id = ${userId}
    `

    logInfo("auth.upgrade.success", { userId, email })

    return NextResponse.json(
      {
        message: "Account upgraded successfully.",
      },
      { status: 200 },
    )
  } catch (err) {
    logError("auth.upgrade_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json(
      { error: "Failed to upgrade account. Please try again." },
      { status: 500 },
    )
  }
}
