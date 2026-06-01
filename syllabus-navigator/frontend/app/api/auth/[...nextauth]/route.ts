/**
 * NextAuth v5 route handler.
 * Handles GET and POST for all /api/auth/* routes.
 */

import { handlers } from "@/lib/auth/auth"

export const { GET, POST } = handlers
