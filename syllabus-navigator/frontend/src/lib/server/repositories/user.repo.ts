/**
 * user.repo — user rows in Neon, keyed to Clerk identities.
 *
 * Clerk owns authentication; this table still owns app data (FKs from chats,
 * messages, usage_records, date_notes, etc. point at `users.id`). Each Clerk
 * user is mirrored here once (lazily, on first authenticated request) so those
 * foreign keys keep resolving to a stable UUID.
 */
import { sql } from "@/lib/db"
import type { Role } from "@/lib/auth/rbac"
import { logInfo } from "@/lib/observability/logger"

// Owner accounts that should always be `admin`. Extend with ADMIN_EMAILS env.
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

export interface ClerkProfile {
  email: string | null
  name: string | null
  image: string | null
}

interface UserRow {
  id: string
  role: Role
}

/**
 * Resolve the Neon user row for a Clerk user id, creating it on first sight.
 * `loadProfile` is only invoked on the create path, so the hot path is a single
 * indexed SELECT. Links a pre-existing row with the same email when present.
 */
export async function getOrCreateUserByClerk(
  clerkId: string,
  loadProfile: () => Promise<ClerkProfile>,
): Promise<UserRow> {
  const found = (await sql`
    SELECT id, role FROM users WHERE clerk_id = ${clerkId}
  `) as UserRow[]
  if (found[0]) return found[0]

  const profile = await loadProfile()
  const email = (profile.email ?? `${clerkId}@clerk.local`).toLowerCase().trim()
  const role: Role = ADMIN_EMAILS.has(email) ? "admin" : "free"

  // Link an existing email row (e.g. legacy account) to this Clerk id, else insert.
  const rows = (await sql`
    INSERT INTO users (clerk_id, email, display_name, role, image)
    VALUES (${clerkId}, ${email}, ${profile.name?.trim() || "User"}, ${role}, ${profile.image ?? null})
    ON CONFLICT (email) DO UPDATE
      SET clerk_id = EXCLUDED.clerk_id,
          image = COALESCE(EXCLUDED.image, users.image),
          role = CASE WHEN users.role = 'admin' THEN 'admin' ELSE EXCLUDED.role END,
          updated_at = now()
    RETURNING id, role
  `) as UserRow[]
  const user = rows[0]

  await sql`
    INSERT INTO user_preferences (user_id, default_provider, default_model)
    VALUES (${user.id}::uuid, 'openai', 'gpt-4o-mini')
    ON CONFLICT (user_id) DO NOTHING
  `

  logInfo("user.clerk.provisioned", { userId: user.id, role: user.role })
  return user
}

/** Current avatar/profile image URL for a user (null when unset). */
export async function getUserImage(userId: string): Promise<string | null> {
  const rows = (await sql`
    SELECT image FROM users WHERE id = ${userId}::uuid
  `) as { image: string | null }[]
  return rows[0]?.image ?? null
}

/** Local profile-name fallback for server-owned audit records. */
export async function getUserDisplayName(userId: string): Promise<string | null> {
  const rows = (await sql`
    SELECT display_name FROM users WHERE id = ${userId}::uuid
  `) as { display_name: string | null }[]
  return rows[0]?.display_name?.trim() || null
}

/** Set (or clear, with null) the user's avatar/profile image URL. */
export async function setUserImage(userId: string, url: string | null): Promise<void> {
  await sql`
    UPDATE users SET image = ${url}, updated_at = now() WHERE id = ${userId}::uuid
  `
}

/**
 * Delete ALL of a user's data in Neon. `chats` and `syllabus_uploads` key on a
 * TEXT user_id without FK (guest legacy), so they're deleted explicitly first —
 * their children (messages, chunks, topics, schedule_events, study_sets…)
 * cascade from them. The users row goes last; everything else (prefs, notes,
 * mastery, user_courses, quiz_review/seen, usage, feedback) cascades from it.
 * Returns the stored-file URLs (uploads + avatar) so the caller can clean up
 * the blobs. Clerk deletion happens client-side AFTER this succeeds (Neon
 * first, so a failed Clerk delete leaves a re-linkable row).
 */
export async function deleteUser(userId: string): Promise<{ fileUrls: string[] }> {
  const uploads = (await sql`
    SELECT file_url FROM syllabus_uploads WHERE user_id = ${userId} AND file_url IS NOT NULL
  `) as { file_url: string }[]
  const avatar = await getUserImage(userId)

  await sql`DELETE FROM chats WHERE user_id = ${userId}`
  await sql`DELETE FROM artifact_runs WHERE user_id = ${userId}`
  await sql`DELETE FROM syllabus_uploads WHERE user_id = ${userId}`
  await sql`DELETE FROM users WHERE id = ${userId}::uuid`

  const fileUrls = uploads.map((u) => u.file_url)
  if (avatar) fileUrls.push(avatar)
  return { fileUrls }
}
