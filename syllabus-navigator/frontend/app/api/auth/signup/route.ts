/**
 * POST /api/auth/signup — Create a new user account.
 *
 * Always returns JSON. Validates email uniqueness, hashes password,
 * creates user + default preferences in Neon.
 */

import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { sql } from "@/lib/db"
import { logError, logInfo } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 6

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)

    if (!body || !body.email || !body.password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 },
      )
    }

    const email = String(body.email).toLowerCase().trim()
    const password = String(body.password)
    const displayName = String(body.name || "User").trim() || "User"

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
      SELECT id FROM users WHERE email = ${email}
    `
    if ((existing as { id: string }[]).length > 0) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 },
      )
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12)

    // Create user
    const rows = await sql`
      INSERT INTO users (email, password_hash, display_name, role)
      VALUES (${email}, ${passwordHash}, ${displayName}, 'free')
      RETURNING id, email, display_name, role
    `

    const user = (rows as { id: string; email: string; display_name: string; role: string }[])[0]

    // Create default preferences
    await sql`
      INSERT INTO user_preferences (user_id, default_provider, default_model)
      VALUES (${user.id}::uuid, 'openai', 'gpt-4o-mini')
    `

    logInfo("auth.signup", { userId: user.id, email: user.email })

    return NextResponse.json(
      {
        message: "Account created successfully.",
        user: {
          id: user.id,
          email: user.email,
          name: user.display_name,
          role: user.role,
        },
      },
      { status: 201 },
    )
  } catch (err) {
    logError("auth.signup_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json(
      { error: "Failed to create account. Please try again." },
      { status: 500 },
    )
  }
}
