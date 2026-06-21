-- =============================================================================
-- Syllabus Navigator — Neon Postgres DDL
-- Aplicar una vez con POST /api/db/migrate  (idempotente, usa IF NOT EXISTS)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;  -- pgvector: embeddings para retrieval RAG

-- ---------------------------------------------------------------------------
-- Users & Preferences
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL DEFAULT 'User',
  role          TEXT NOT NULL DEFAULT 'free',
  tenant_id     UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS user_preferences (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  default_provider TEXT NOT NULL DEFAULT 'openai',
  default_model    TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  theme            TEXT NOT NULL DEFAULT 'dark',
  language         TEXT NOT NULL DEFAULT 'es',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- MVP RAG uploads
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS syllabus_uploads (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          TEXT        NOT NULL,
  original_filename TEXT       NOT NULL,
  source_hash      TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending',
  error_message    TEXT,
  graph_status     TEXT        NOT NULL DEFAULT 'pending',
  graph_error      TEXT,
  graph_generated_at TIMESTAMPTZ,
  file_url         TEXT,        -- URL del PDF en blob store (solo cuentas; NULL para invitados)
  expires_at       TIMESTAMPTZ, -- NULL = persistente; con valor = efímero (invitado), borrado por cron
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_hash)
);

-- Columnas añadidas para despliegues existentes (idempotente)
ALTER TABLE syllabus_uploads ADD COLUMN IF NOT EXISTS file_url   TEXT;
ALTER TABLE syllabus_uploads ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_syllabus_uploads_user_id ON syllabus_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_syllabus_uploads_status  ON syllabus_uploads(status);
CREATE INDEX IF NOT EXISTS idx_syllabus_uploads_expires ON syllabus_uploads(expires_at);

-- ---------------------------------------------------------------------------
-- Chunks + embeddings (pgvector) — núcleo del retrieval RAG
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chunks (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  syllabus_id  UUID          NOT NULL REFERENCES syllabus_uploads(id) ON DELETE CASCADE,
  chunk_index  INT           NOT NULL,
  content      TEXT          NOT NULL,
  embedding    vector(1536),               -- text-embedding-3-small
  page_start   INT,
  page_end     INT,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (syllabus_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_chunks_syllabus_id ON chunks(syllabus_id);
-- Índice ANN por similitud coseno (operador <=>). Requiere pgvector >= 0.5 (HNSW).
CREATE INDEX IF NOT EXISTS idx_chunks_embedding
  ON chunks USING hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Future schema: programs / courses / syllabi (Sprint 4)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS programs (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT        NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courses (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id  UUID        REFERENCES programs(id) ON DELETE SET NULL,
  code        TEXT,
  name        TEXT        NOT NULL,
  term        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, term)
);

CREATE TABLE IF NOT EXISTS syllabi (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id       UUID        NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  version         INT         NOT NULL DEFAULT 1,
  title           TEXT        NOT NULL,
  source_file_url TEXT,
  source_hash     TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'processed',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course_id, version),
  UNIQUE (source_hash)
);

-- ---------------------------------------------------------------------------
-- Knowledge Graph — topics and dependencies
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS topics (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  syllabus_id  UUID          NOT NULL REFERENCES syllabus_uploads(id) ON DELETE CASCADE,
  external_id  TEXT          NOT NULL,
  label        TEXT          NOT NULL,
  description  TEXT,
  weight_percent NUMERIC(5,2) CHECK (weight_percent >= 0 AND weight_percent <= 100),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (syllabus_id, external_id)
);

CREATE TABLE IF NOT EXISTS topic_dependencies (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  syllabus_id           UUID          NOT NULL REFERENCES syllabus_uploads(id) ON DELETE CASCADE,
  prerequisite_topic_id UUID          NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  target_topic_id       UUID          NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  relation_type         TEXT          NOT NULL DEFAULT 'prerequisite',
  confidence            NUMERIC(4,3)  CHECK (confidence >= 0 AND confidence <= 1),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CHECK (prerequisite_topic_id <> target_topic_id),
  UNIQUE (prerequisite_topic_id, target_topic_id, relation_type)
);

-- ---------------------------------------------------------------------------
-- Chat threads and messages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chats (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      TEXT        NOT NULL,
  title        TEXT        NOT NULL DEFAULT 'New chat',
  active_model TEXT        NOT NULL DEFAULT 'gpt-4o-mini',
  syllabus_id  UUID        REFERENCES syllabus_uploads(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chats_user_id    ON chats(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_syllabus_id ON chats(syllabus_id);

CREATE TABLE IF NOT EXISTS messages (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id    UUID        NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL CHECK (role IN ('user','ai')),
  content    TEXT        NOT NULL,
  citations  JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);

-- ---------------------------------------------------------------------------
-- Usage, Feedback & Jobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usage_records (
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
);

CREATE TABLE IF NOT EXISTS feedback (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  rating     SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
  comment    TEXT,
  prompt_id  TEXT,
  model      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
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
);
