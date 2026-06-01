import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { sql } from "@/lib/db"
import { logError, logInfo } from "@/lib/observability/logger"
import type { Role } from "./rbac"
import { authConfig } from "./auth.config"

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        isGuest: { type: "hidden" }
      },
      async authorize(credentials) {
        const isGuest = credentials?.isGuest as string | undefined

        // Guest Flow
        if (isGuest === "true") {
          try {
            const guestId = crypto.randomUUID()
            const email = `guest-${guestId}@navigator.local`
            const passwordHash = await bcrypt.hash(guestId, 10) // secure enough for internal

            const rows = await sql`
              INSERT INTO users (email, password_hash, display_name, role)
              VALUES (${email}, ${passwordHash}, 'Guest', 'guest')
              RETURNING id, email, display_name, role
            `
            const user = (rows as { id: string; email: string; display_name: string; role: Role }[])[0]

            await sql`
              INSERT INTO user_preferences (user_id, default_provider, default_model)
              VALUES (${user.id}::uuid, 'openai', 'gpt-4o-mini')
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
