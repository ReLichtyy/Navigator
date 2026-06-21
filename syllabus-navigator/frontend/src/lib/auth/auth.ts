import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { sql } from "@/lib/db"
import { logError, logInfo } from "@/lib/observability/logger"
import type { Role } from "./rbac"
import { authConfig } from "./auth.config"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Owner accounts that should always be `admin` (see all models, no tier limits).
// Extend at runtime with ADMIN_EMAILS="a@x.com,b@y.com".
const ADMIN_EMAILS = new Set(
  [
    "joshuabellocalero@gmail.com",
    "joshua1230684@gmail.com",
    "cloudiaholochat@gmail.com",
    ...(process.env.ADMIN_EMAILS ?? "").split(","),
  ]
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
)

/**
 * Find-or-create a DB user for a Google sign-in. Returns the real Neon row
 * (its UUID + role) so the JWT carries our id, not Google's `sub`.
 */
async function upsertOAuthUser(input: {
  email: string
  name?: string | null
  image?: string | null
}): Promise<{ id: string; role: Role; display_name: string } | null> {
  const email = input.email.toLowerCase().trim()
  const desiredRole: Role = ADMIN_EMAILS.has(email) ? "admin" : "free"
  try {
    const existing = (await sql`
      SELECT id, role, display_name FROM users WHERE email = ${email}
    `) as { id: string; role: Role; display_name: string }[]

    if (existing[0]) {
      // Keep image fresh and ensure owner accounts are promoted to admin.
      const promote = ADMIN_EMAILS.has(email) && existing[0].role !== "admin"
      if (input.image || promote) {
        await sql`
          UPDATE users
          SET image = COALESCE(${input.image ?? null}, image),
              role = ${promote ? "admin" : existing[0].role},
              updated_at = now()
          WHERE id = ${existing[0].id}::uuid
        `
      }
      return { ...existing[0], role: promote ? "admin" : existing[0].role }
    }

    const rows = (await sql`
      INSERT INTO users (email, display_name, role, image)
      VALUES (${email}, ${input.name?.trim() || "User"}, ${desiredRole}, ${input.image ?? null})
      RETURNING id, role, display_name
    `) as { id: string; role: Role; display_name: string }[]
    const user = rows[0]

    await sql`
      INSERT INTO user_preferences (user_id, default_provider, default_model)
      VALUES (${user.id}::uuid, 'openai', 'gpt-4o-mini')
      ON CONFLICT (user_id) DO NOTHING
    `

    logInfo("auth.google.created", { userId: user.id })
    return user
  } catch (err) {
    logError("auth.google.upsert_failed", { error: String(err) })
    return null
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, account, profile }) {
      // Google sign-in: resolve (or create) the real DB user and stamp our id/role.
      if (account?.provider === "google" && profile?.email) {
        const dbUser = await upsertOAuthUser({
          email: profile.email,
          name: (profile.name as string | undefined) ?? user?.name,
          image: (profile.picture as string | undefined) ?? user?.image,
        })
        if (dbUser) {
          token.id = dbUser.id
          token.role = dbUser.role
          token.name = dbUser.display_name
        }
        return token
      }
      // Credentials / guest: `user.id` is already our DB id.
      if (user) {
        token.id = user.id
        token.role = user.role ?? "free"
      }
      return token
    },
  },
  providers: [
    // Plain OAuth2 (NOT the OIDC `Google()` helper) on purpose. Google's OIDC
    // discovery advertises `authorization_response_iss_parameter_supported`, which
    // makes oauth4webapi REQUIRE an `iss` param on the callback and throw
    // "response parameter iss (issuer) missing" when Google omits it. A manual
    // `type: "oauth"` provider skips discovery entirely, so that check never runs;
    // we read the user from the userinfo endpoint.
    {
      id: "google",
      name: "Google",
      type: "oauth",
      // Google returns `iss=https://accounts.google.com` on the callback; setting
      // it here makes oauth4webapi's iss check match instead of throwing
      // "unexpected iss response parameter value".
      issuer: "https://accounts.google.com",
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: true,
      authorization: {
        url: "https://accounts.google.com/o/oauth2/v2/auth",
        params: { scope: "openid email profile", prompt: "select_account" },
      },
      token: "https://oauth2.googleapis.com/token",
      userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
      checks: ["pkce", "state"],
      profile(profile: { sub: string; name?: string; email?: string; picture?: string }) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: profile.picture,
        }
      },
    },
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        isGuest: { type: "hidden" },
        guestId: { type: "hidden" }
      },
      async authorize(credentials) {
        const isGuest = credentials?.isGuest as string | undefined

        // Guest Flow
        if (isGuest === "true") {
          try {
            // The client persists a guestId (localStorage) and presents it on each
            // visit. If it maps to an existing guest we REUSE that row instead of
            // inserting a new one — this stops the users table growing on every
            // repeated "Try as guest" click / cookie loss. The guestId doubles as
            // the secret: ownership is verified via bcrypt before reuse.
            const provided = (credentials?.guestId as string | undefined)?.trim()
            const hasValidId = Boolean(provided && UUID_RE.test(provided))

            if (hasValidId) {
              const email = `guest-${provided}@navigator.local`
              const existing = (await sql`
                SELECT id, email, password_hash, display_name, role
                FROM users
                WHERE email = ${email} AND role = 'guest'
              `) as { id: string; email: string; password_hash: string; display_name: string; role: Role }[]

              const row = existing[0]
              if (row && (await bcrypt.compare(provided as string, row.password_hash))) {
                logInfo("auth.guest.reused", { userId: row.id })
                return { id: row.id, email: row.email, name: row.display_name, role: row.role }
              }
            }

            // No (valid) prior identity → mint a fresh guest, reusing the client's
            // id when it's a well-formed UUID so it can be reused next time.
            const guestId = hasValidId ? (provided as string) : crypto.randomUUID()
            const email = `guest-${guestId}@navigator.local`
            const passwordHash = await bcrypt.hash(guestId, 10) // secure enough for internal

            const rows = await sql`
              INSERT INTO users (email, password_hash, display_name, role)
              VALUES (${email}, ${passwordHash}, 'Guest', 'guest')
              ON CONFLICT (email) DO NOTHING
              RETURNING id, email, display_name, role
            `
            const user = (rows as { id: string; email: string; display_name: string; role: Role }[])[0]

            // ON CONFLICT DO NOTHING returns no row when it raced with another
            // insert for the same email — fall back to reading the existing row.
            if (!user) {
              const again = (await sql`
                SELECT id, email, display_name, role FROM users WHERE email = ${email}
              `) as { id: string; email: string; display_name: string; role: Role }[]
              const existing = again[0]
              if (!existing) throw new Error("guest insert returned no row")
              logInfo("auth.guest.reused", { userId: existing.id })
              return { id: existing.id, email: existing.email, name: existing.display_name, role: existing.role }
            }

            await sql`
              INSERT INTO user_preferences (user_id, default_provider, default_model)
              VALUES (${user.id}::uuid, 'openai', 'gpt-4o-mini')
              ON CONFLICT (user_id) DO NOTHING
            `

            logInfo("auth.guest.created", { userId: user.id })

            return {
              id: user.id,
              email: user.email,
              name: user.display_name,
              role: user.role,
            }
          } catch (err) {
            logError("auth.guest.create_failed", { error: String(err) })
            return null
          }
        }

        // Normal Flow
        const email = credentials?.email as string | undefined
        const password = credentials?.password as string | undefined

        if (!email || !password) return null

        try {
          const rows = await sql`
            SELECT id, email, password_hash, display_name, role
            FROM users
            WHERE email = ${email.toLowerCase().trim()}
          `

          const user = (rows as {
            id: string
            email: string
            password_hash: string
            display_name: string
            role: Role
          }[])[0]

          if (!user) {
            logInfo("auth.login.not_found", { email })
            return null
          }

          // OAuth-only account (no password set) → reject password login.
          if (!user.password_hash) {
            logInfo("auth.login.no_password", { email })
            return null
          }

          const valid = await bcrypt.compare(password, user.password_hash)
          if (!valid) {
            logInfo("auth.login.invalid_password", { email })
            return null
          }

          logInfo("auth.login.success", { userId: user.id, role: user.role })

          return {
            id: user.id,
            email: user.email,
            name: user.display_name,
            role: user.role,
          }
        } catch (err) {
          logError("auth.login.error", { error: String(err) })
          return null
        }
      },
    }),
  ],
})
