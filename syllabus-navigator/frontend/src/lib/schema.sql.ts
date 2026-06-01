import { sql } from "@/lib/db"

const REQUIRED_TABLES = [
  "users",
  "user_preferences",
  "syllabus_uploads",
  "chats",
  "messages",
  "usage_records",
  "feedback",
  "jobs",
]

const UP_MIGRATIONS = [
  // 1. Users
  `CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL DEFAULT 'User',
    role          TEXT NOT NULL DEFAULT 'free',
    tenant_id     UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
  `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`,

  // 2. User Preferences
  `CREATE TABLE IF NOT EXISTS user_preferences (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    default_provider TEXT NOT NULL DEFAULT 'openai',
    default_model    TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    theme            TEXT NOT NULL DEFAULT 'dark',
    language         TEXT NOT NULL DEFAULT 'es',
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,

  // 3. Syllabus Uploads (alter existing if needed, but existing is TEXT user_id)
  // For backwards compatibility during transition, we leave user_id as TEXT.
  // New records will insert UUID strings.
  `CREATE TABLE IF NOT EXISTS syllabus_uploads (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id           TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending',
    graph_status      TEXT NOT NULL DEFAULT 'pending',
    graph_error       TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,

  // 4. Chats
  `CREATE TABLE IF NOT EXISTS chats (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      TEXT NOT NULL,
    syllabus_id  UUID REFERENCES syllabus_uploads(id) ON DELETE SET NULL,
    title        TEXT NOT NULL DEFAULT 'New chat',
    active_model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,

  // 5. Messages
  `CREATE TABLE IF NOT EXISTS messages (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chat_id    UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    citations  JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,

  // 6. Usage Records
  `CREATE TABLE IF NOT EXISTS usage_records (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider           TEXT NOT NULL,
    model              TEXT NOT NULL,
    prompt_tokens      INT NOT NULL DEFAULT 0,
    completion_tokens  INT NOT NULL DEFAULT 0,
    total_tokens       INT NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
    latency_ms         INT NOT NULL DEFAULT 0,
    chat_id            UUID REFERENCES chats(id) ON DELETE SET NULL,
    success            BOOLEAN NOT NULL DEFAULT true,
    error_type         TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,

  // 7. Feedback
  `CREATE TABLE IF NOT EXISTS feedback (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    rating     SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
    comment    TEXT,
    prompt_id  TEXT,
    model      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,

  // 8. Jobs
  `CREATE TABLE IF NOT EXISTS jobs (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type         TEXT NOT NULL,
    payload      JSONB NOT NULL DEFAULT '{}',
    status       TEXT NOT NULL DEFAULT 'pending',
    priority     INT NOT NULL DEFAULT 0,
    result       JSONB,
    error        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at   TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
  );`,
]

export async function checkMigrationStatus() {
  const tableRows = await sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `
  const found = (tableRows as { tablename: string }[]).map((r) => r.tablename)
  const missing = REQUIRED_TABLES.filter((t) => !found.includes(t))
  return { is_migrated: missing.length === 0, missing_tables: missing }
}

export async function runMigrations() {
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`
  let executed = 0
  for (const query of UP_MIGRATIONS) {
    try {
      await sql.unsafe(query)
      executed++
    } catch (e) {
      console.error(`Migration failed: ${query}`, e)
      throw e
    }
  }
  return { status: "success", executed_statements: executed }
}
