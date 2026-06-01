/**
 * auth/config.ts — NextAuth v5 configuration.
 *
 * Uses Credentials provider with email + bcrypt password.
 * Session strategy: JWT (stateless, no session table needed at runtime).
 * User data stored in Neon Postgres.
 */

import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { sql } from "@/lib/db"
import type { Role } from "./rbac"

declare module "next-auth" {
  interface User {
    role?: Role
  }
  interface Session {
    user: {
      id: string
      email: string
      name: string
      role: Role
    }
  }
}

declare module "next-auth" {
  interface JWT {
    id: string
    role: Role
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
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

          if (!user) return null

          const valid = await bcrypt.compare(password, user.password_hash)
          if (!valid) return null

          return {
            id: user.id,
            email: user.email,
            name: user.display_name,
            role: user.role,
          }
        } catch {
          return null
        }
      },
    }),
  ],

  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },

  pages: {
    signIn: "/login",
    // signUp is a custom page, not a NextAuth built-in
  },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string
        token.role = (user.role as Role) ?? "free"
      }
      return token
    },
    async session({ session, token }) {
      session.user.id = token.id as string
      session.user.role = (token.role as Role) ?? "free"
      return session
    },
  },

  trustHost: true, // Required for Vercel
})
