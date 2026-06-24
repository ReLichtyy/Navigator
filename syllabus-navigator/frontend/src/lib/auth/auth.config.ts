import type { NextAuthConfig } from "next-auth"
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

export const authConfig = {
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role ?? "free"
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = (token.role as any) ?? "free"
      }
      return session
    },
  },
  providers: [], // Configured in auth.ts
  trustHost: true,
} satisfies NextAuthConfig
