import { sql } from "@/lib/db"
import type { ChatOutAPI } from "@/types/api"

export interface DbChat {
  id: string
  active_model: string
  syllabus_id: string | null
  course_id: string | null
}

/** Full chat row as the detail/update endpoints return it. */
export interface DbChatRow {
  id: string
  title: string
  active_model: string
  syllabus_id: string | null
  course_id: string | null
  created_at: string
}

export interface DbMessage {
  role: string
  content: string
}

export const ChatRepository = {
  async findByIdAndUser(chatId: string, userId: string): Promise<DbChat | undefined> {
    const rows = await sql`
      SELECT id, active_model, syllabus_id, course_id
      FROM chats
      WHERE id = ${chatId}::uuid AND user_id = ${userId}
    `
    return rows[0] as DbChat | undefined
  },

  /** Chat detail + full message list (ownership-scoped). Undefined when not owned. */
  async getDetailWithMessages(
    chatId: string,
    userId: string,
  ): Promise<{ chat: DbChatRow; messages: unknown[] } | undefined> {
    const chatRows = await sql`
      SELECT id, title, active_model, syllabus_id, course_id, created_at
      FROM chats
      WHERE id = ${chatId}::uuid AND user_id = ${userId}
    `
    const chat = chatRows[0] as DbChatRow | undefined
    if (!chat) return undefined
    const messages = await sql`
      SELECT id, role, content, citations, suggestions, created_at
      FROM messages
      WHERE chat_id = ${chatId}::uuid
      ORDER BY created_at ASC
    `
    return { chat, messages: messages as unknown[] }
  },

  /**
   * Apply a partial update (title / active_model / syllabus_id) in ONE statement.
   * `undefined` fields are left untouched; `syllabus_id: null` unbinds the chat.
   * Ownership-scoped; returns the updated row or undefined when not owned.
   */
  async updateChat(
    chatId: string,
    userId: string,
    patch: { title?: string; active_model?: string; syllabus_id?: string | null },
  ): Promise<DbChatRow | undefined> {
    const setTitle = patch.title !== undefined
    const setModel = patch.active_model !== undefined
    const setSyllabus = patch.syllabus_id !== undefined
    const rows = await sql`
      UPDATE chats SET
        title        = CASE WHEN ${setTitle}    THEN ${patch.title ?? null}            ELSE title END,
        active_model = CASE WHEN ${setModel}    THEN ${patch.active_model ?? null}     ELSE active_model END,
        syllabus_id  = CASE WHEN ${setSyllabus} THEN ${patch.syllabus_id ?? null}::uuid ELSE syllabus_id END
      WHERE id = ${chatId}::uuid AND user_id = ${userId}
      RETURNING id, title, active_model, syllabus_id, course_id, created_at
    `
    return rows[0] as DbChatRow | undefined
  },

  /**
   * Delete a chat scoped to its owner; messages cascade (messages.chat_id ON
   * DELETE CASCADE). Returns false when the chat wasn't owned/found.
   */
  async deleteChat(chatId: string, userId: string): Promise<boolean> {
    const rows = await sql`
      DELETE FROM chats WHERE id = ${chatId}::uuid AND user_id = ${userId}
      RETURNING id
    `
    return rows.length > 0
  },

  async getRecentHistory(chatId: string, limit: number): Promise<DbMessage[]> {
    const rows = await sql`
      SELECT role, content 
      FROM (
        SELECT role, content, created_at
        FROM messages
        WHERE chat_id = ${chatId}::uuid
        ORDER BY created_at DESC
        LIMIT ${limit}
      ) as recent
      ORDER BY created_at ASC
    `
    return rows as DbMessage[]
  },

  /**
   * Cheap "is this the first turn?" check — avoids loading the whole message
   * list just to test `length === 0` on every message (BUG-005). Must be called
   * BEFORE the user turn is persisted.
   */
  async hasMessages(chatId: string): Promise<boolean> {
    const rows = await sql`
      SELECT EXISTS(SELECT 1 FROM messages WHERE chat_id = ${chatId}::uuid) AS has
    `
    return (rows as { has: boolean }[])[0].has
  },

  async getAllHistory(chatId: string): Promise<DbMessage[]> {
    const rows = await sql`
      SELECT role, content 
      FROM messages
      WHERE chat_id = ${chatId}::uuid
      ORDER BY created_at ASC
    `
    return rows as DbMessage[]
  },

  async saveMessage(
    chatId: string,
    role: string,
    content: string,
    citations?: unknown[],
    suggestions?: unknown[],
  ): Promise<string> {
    const citationsJson = citations && citations.length > 0 ? JSON.stringify(citations) : null
    const suggestionsJson =
      suggestions && suggestions.length > 0 ? JSON.stringify(suggestions) : null
    const rows = await sql`
      INSERT INTO messages (chat_id, role, content, citations, suggestions)
      VALUES (
        ${chatId}::uuid,
        ${role},
        ${content},
        ${citationsJson}::jsonb,
        ${suggestionsJson}::jsonb
      )
      RETURNING id
    `
    return (rows[0] as { id: string }).id
  },

  async updateTitle(chatId: string, title: string): Promise<void> {
    await sql`
      UPDATE chats 
      SET title = ${title} 
      WHERE id = ${chatId}::uuid
    `
  },

  async countChats(userId: string): Promise<number> {
    // chats.user_id is TEXT (not UUID) — comparing against a ::uuid cast throws
    // "operator does not exist: text = uuid" in Postgres. Keep it TEXT = TEXT.
    const rows = await sql`SELECT COUNT(id)::int as total FROM chats WHERE user_id = ${userId}`
    return (rows as { total: number }[])[0].total
  },

  async listChats(userId: string) {
    return sql`
      SELECT
        c.id, c.title, c.active_model, c.syllabus_id, c.course_id,
        COALESCE(su.original_filename, uc.name) AS syllabus_name,
        c.created_at,
        COUNT(m.id)::int AS message_count
      FROM chats c
      LEFT JOIN messages m ON m.chat_id = c.id
      LEFT JOIN syllabus_uploads su ON su.id = c.syllabus_id
      LEFT JOIN user_courses uc ON uc.id = c.course_id
      WHERE c.user_id = ${userId}
      GROUP BY c.id, su.original_filename, uc.name
      ORDER BY c.created_at DESC
    `
  },

  async createChat(userId: string, syllabusId: string | null, courseId: string | null) {
    const rows = await sql`
      INSERT INTO chats (user_id, title, active_model, syllabus_id, course_id)
      VALUES (
        ${userId},
        'New chat',
        'gpt-4o-mini',
        ${syllabusId},
        ${courseId}
      )
      RETURNING id, title, active_model, syllabus_id, course_id, created_at
    `
    return rows[0]
  },

  /** Find the most-recent chat bound to a specific syllabus for this user. */
  async findByUserAndSyllabus(userId: string, syllabusId: string): Promise<DbChatRow | undefined> {
    const rows = await sql`
      SELECT id, title, active_model, syllabus_id, course_id, created_at
      FROM chats
      WHERE user_id = ${userId} AND syllabus_id = ${syllabusId}::uuid
      ORDER BY created_at DESC
      LIMIT 1
    `
    return rows[0] as DbChatRow | undefined
  },
}
