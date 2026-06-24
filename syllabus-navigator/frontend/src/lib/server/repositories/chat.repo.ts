import { sql } from "@/lib/db"
import type { ChatOutAPI } from "@/types/api"

export interface DbChat {
  id: string
  active_model: string
  syllabus_id: string | null
}

export interface DbMessage {
  role: string
  content: string
}

export const ChatRepository = {
  async findByIdAndUser(chatId: string, userId: string): Promise<DbChat | undefined> {
    const rows = await sql`
      SELECT id, active_model, syllabus_id 
      FROM chats
      WHERE id = ${chatId}::uuid AND user_id = ${userId}
    `
    return rows[0] as DbChat | undefined
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
  ): Promise<void> {
    const citationsJson = citations && citations.length > 0 ? JSON.stringify(citations) : null
    await sql`
      INSERT INTO messages (chat_id, role, content, citations)
      VALUES (${chatId}::uuid, ${role}, ${content}, ${citationsJson}::jsonb)
    `
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
        c.id, c.title, c.active_model, c.syllabus_id,
        su.original_filename AS syllabus_name,
        c.created_at,
        COUNT(m.id)::int AS message_count
      FROM chats c
      LEFT JOIN messages m ON m.chat_id = c.id
      LEFT JOIN syllabus_uploads su ON su.id = c.syllabus_id
      WHERE c.user_id = ${userId}
      GROUP BY c.id, su.original_filename
      ORDER BY c.created_at DESC
    `
  },

  async createChat(userId: string, syllabusId: string | null) {
    const rows = await sql`
      INSERT INTO chats (user_id, title, active_model, syllabus_id)
      VALUES (
        ${userId},
        'New chat',
        'gpt-4o-mini',
        ${syllabusId}
      )
      RETURNING id, title, active_model, syllabus_id, created_at
    `
    return rows[0]
  },
}
