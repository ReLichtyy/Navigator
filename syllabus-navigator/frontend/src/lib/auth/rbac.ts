/**
 * auth/rbac.ts — Role-Based Access Control.
 *
 * P0: Simple role definitions and permission checks.
 * P1: Admin panel, role management, tenant isolation.
 */

export type Role = "free" | "pro" | "admin"

export type Permission =
  | "chat"
  | "upload"
  | "graph"
  | "feedback"
  | "usage:own"
  | "admin:users"
  | "admin:settings"
  | "admin:usage:all"

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  free: ["chat", "upload", "graph", "feedback", "usage:own"],
  pro: ["chat", "upload", "graph", "feedback", "usage:own"],
  admin: [
    "chat",
    "upload",
    "graph",
    "feedback",
    "usage:own",
    "admin:users",
    "admin:settings",
    "admin:usage:all",
  ],
}

/**
 * Check if a role has a specific permission.
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role]
  return perms ? perms.includes(permission) : false
}

/**
 * Get all permissions for a role.
 */
export function getPermissions(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? []
}

/**
 * Get rate limit tier from role.
 */
export function getRateLimitTier(role: Role): "free" | "pro" | "admin" {
  return role
}
