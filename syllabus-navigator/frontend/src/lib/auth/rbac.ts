/**
 * auth/rbac.ts — Role-Based Access Control.
 *
 * P0: Simple role definitions and permission checks.
 * P1: Admin panel, role management, tenant isolation.
 */

export type Role = "guest" | "free" | "pro" | "admin"

/**
 * Get rate limit tier from role.
 */
export function getRateLimitTier(role: Role): "guest" | "free" | "pro" | "admin" {
  return role
}
