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
  password_hash TEXT,                                  -- legacy NextAuth/credentials; NULL bajo Clerk
  display_name  TEXT NOT NULL DEFAULT 'User',
  role          TEXT NOT NULL DEFAULT 'free',
  image         TEXT,                                  -- avatar URL del proveedor (Google/Clerk)
  clerk_id      TEXT UNIQUE,                           -- id de usuario en Clerk (user_xxx)
  tenant_id     UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migración de despliegues existentes: password_hash deja de ser obligatorio (OAuth/Clerk)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS image TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_id TEXT;

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_clerk_id ON users(clerk_id) WHERE clerk_id IS NOT NULL;

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
  source_type      TEXT        NOT NULL DEFAULT 'pdf',  -- pdf | link | text
  source_url       TEXT,        -- URL original (solo fuentes 'link')
  status           TEXT        NOT NULL DEFAULT 'pending', -- pending|processed|error|needs_ocr
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
ALTER TABLE syllabus_uploads ADD COLUMN IF NOT EXISTS file_url    TEXT;
ALTER TABLE syllabus_uploads ADD COLUMN IF NOT EXISTS expires_at  TIMESTAMPTZ;
ALTER TABLE syllabus_uploads ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'pdf';
ALTER TABLE syllabus_uploads ADD COLUMN IF NOT EXISTS source_url  TEXT;

-- Course Intelligence Layer: inferred course assignment for a document.
-- course_id is only set AFTER the user confirms a suggestion (NULL = sin curso).
-- inferred_course / infer_confidence hold the latest suggestion shown to the user.
-- infer_status drives the confirm/reject UI flow.
ALTER TABLE syllabus_uploads ADD COLUMN IF NOT EXISTS course_id        UUID;
ALTER TABLE syllabus_uploads ADD COLUMN IF NOT EXISTS inferred_course  TEXT;
ALTER TABLE syllabus_uploads ADD COLUMN IF NOT EXISTS infer_confidence REAL;
ALTER TABLE syllabus_uploads ADD COLUMN IF NOT EXISTS infer_status     TEXT NOT NULL DEFAULT 'pending';
-- Guard the status domain (added separately so it's idempotent on existing DBs).
DO $$ BEGIN
  ALTER TABLE syllabus_uploads ADD CONSTRAINT syllabus_uploads_infer_status_chk
    CHECK (infer_status IN ('pending','suggested','confirmed','rejected','skipped'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_syllabus_uploads_course ON syllabus_uploads(course_id);

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
  page_start   INT,                        -- locator de página (fuentes 'pdf')
  page_end     INT,
  char_start   INT,                        -- locator por offset de carácter (fuentes 'link'/'text')
  char_end     INT,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (syllabus_id, chunk_index)
);

-- Locators por carácter para fuentes sin paginación (idempotente).
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS char_start INT;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS char_end   INT;

CREATE INDEX IF NOT EXISTS idx_chunks_syllabus_id ON chunks(syllabus_id);
-- Índice ANN por similitud coseno (operador <=>). Requiere pgvector >= 0.5 (HNSW).
CREATE INDEX IF NOT EXISTS idx_chunks_embedding
  ON chunks USING hnsw (embedding vector_cosine_ops);

-- Step 2 (hybrid search): índice léxico full-text para términos exactos / fórmulas /
-- nombres que el embedding pierde. Columna generada (siempre en sincronía con
-- content) + GIN. Se fusiona con el vector vía RRF en lib/server/rag/retrieval/hybrid.
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS ts tsvector
  GENERATED ALWAYS AS (to_tsvector('spanish', content)) STORED;
CREATE INDEX IF NOT EXISTS idx_chunks_ts ON chunks USING gin (ts);

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
-- Schedule / cronograma — structured calendar events extracted from the syllabus
-- Powers "what quizzes/topics this week?" chat answers and the agenda view.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schedule_events (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  syllabus_id    UUID        NOT NULL REFERENCES syllabus_uploads(id) ON DELETE CASCADE,
  user_id        TEXT        NOT NULL,  -- denormalized so "my agenda" spans all courses
  event_type     TEXT        NOT NULL DEFAULT 'other', -- quiz|exam|assignment|project|class|reading|other
  title          TEXT        NOT NULL,
  description    TEXT,
  event_date     DATE,                  -- absolute date when resolvable, else NULL
  week_label     TEXT,                  -- e.g. "Semana 3" when no absolute date
  weight_percent NUMERIC(5,2) CHECK (weight_percent >= 0 AND weight_percent <= 100),
  source_excerpt TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedule_syllabus   ON schedule_events(syllabus_id);
CREATE INDEX IF NOT EXISTS idx_schedule_user_date  ON schedule_events(user_id, event_date);

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
  attempts     INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  result       JSONB,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
-- Retry/backoff columns for existing deployments.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS attempts     INT NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS max_attempts INT NOT NULL DEFAULT 3;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Claim ordering / due-time lookups.
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs (type, status, scheduled_at);

-- Cached study material (flashcards/quiz/summary/mindmap) generated per syllabus.
-- One row per syllabus; regenerated on demand (?refresh=1). Cascades on upload delete.
CREATE TABLE IF NOT EXISTS study_sets (
  syllabus_id  UUID PRIMARY KEY REFERENCES syllabus_uploads(id) ON DELETE CASCADE,
  data         JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Free-form notes the student writes against a specific agenda date. Many per day.
CREATE TABLE IF NOT EXISTS date_notes (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_date  DATE NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS date_notes_user_date_idx ON date_notes (user_id, note_date);

-- Spaced-repetition state per flashcard (Modo repaso). card_key is a stable hash
-- of the card front so it survives study-set regeneration. Leitner-style boxes.
CREATE TABLE IF NOT EXISTS flashcard_reviews (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  syllabus_id UUID NOT NULL REFERENCES syllabus_uploads(id) ON DELETE CASCADE,
  card_key    TEXT NOT NULL,
  box         INT NOT NULL DEFAULT 0,
  due_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_result TEXT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, syllabus_id, card_key)
);
CREATE INDEX IF NOT EXISTS flashcard_reviews_due_idx ON flashcard_reviews (user_id, syllabus_id, due_at);
CREATE INDEX IF NOT EXISTS flashcard_reviews_user_time_idx ON flashcard_reviews (user_id, reviewed_at);

-- Mastery ledger (Sprint 4) — per-topic confidence that evolves as the student
-- practises. confidence is an exponential moving average of quiz outcomes in
-- [0,1]. topic_key is a normalized (lowercased) topic label so it survives
-- study-set / graph regeneration. One row per (user, syllabus, topic_key).
CREATE TABLE IF NOT EXISTS topic_mastery (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  syllabus_id UUID NOT NULL REFERENCES syllabus_uploads(id) ON DELETE CASCADE,
  topic_key   TEXT NOT NULL,
  label       TEXT NOT NULL,
  confidence  NUMERIC(4,3) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  attempts    INT  NOT NULL DEFAULT 0,
  correct     INT  NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, syllabus_id, topic_key)
);
CREATE INDEX IF NOT EXISTS topic_mastery_user_idx ON topic_mastery (user_id, syllabus_id);

-- ---------------------------------------------------------------------------
-- Course Intelligence Layer (Navigator) — user-defined courses + auto-inference
-- ---------------------------------------------------------------------------
-- A user's own course folders. The legacy `courses` table (program/code/term,
-- Sprint-4 stub, never written) is intentionally left untouched; this is the
-- live, user-scoped entity that documents get assigned to after confirmation.
CREATE TABLE IF NOT EXISTS user_courses (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  description  TEXT,
  subject_tags TEXT[],                 -- e.g. ['arquitectura','software','patrones']
  color        TEXT,                   -- UI accent
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_user_courses_user ON user_courses(user_id);

-- Now that user_courses exists, point syllabus_uploads.course_id at it (idempotent).
DO $$ BEGIN
  ALTER TABLE syllabus_uploads ADD CONSTRAINT syllabus_uploads_course_fk
    FOREIGN KEY (course_id) REFERENCES user_courses(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- History of course suggestions per document — kept to learn/improve over time.
CREATE TABLE IF NOT EXISTS course_suggestions (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id         UUID        NOT NULL REFERENCES syllabus_uploads(id) ON DELETE CASCADE,
  suggested_course_id UUID        REFERENCES user_courses(id) ON DELETE SET NULL,
  suggested_name      TEXT        NOT NULL,   -- inferred name even if the course doesn't exist yet
  confidence          REAL        NOT NULL,
  method              TEXT        NOT NULL,   -- 'filename' | 'content' | 'embedding' | 'combined'
  accepted            BOOLEAN,                -- NULL = pending, true = accepted, false = rejected
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_course_suggestions_doc ON course_suggestions(document_id);

-- Cached WHOLE-COURSE study set: aggregates the chunks of every PDF in a course
-- into one set. Keyed by course (vs study_sets, keyed per single syllabus).
-- Regenerated on demand (?refresh=1). Cascades when the course is deleted.
CREATE TABLE IF NOT EXISTS course_study_sets (
  course_id    UUID PRIMARY KEY REFERENCES user_courses(id) ON DELETE CASCADE,
  data         JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Study Engine — Step 1: versioned cache + persistent item bank
-- ---------------------------------------------------------------------------
-- Versioned cache invalidation for the cached bundle sets. A cached set is only
-- reused when its content_fingerprint (cheap signal of the underlying chunks)
-- AND schema_version still match — so editing/re-uploading a PDF, or bumping the
-- generator schema, invalidates it automatically (idempotent ALTERs).
ALTER TABLE study_sets        ADD COLUMN IF NOT EXISTS content_fingerprint TEXT;
ALTER TABLE study_sets        ADD COLUMN IF NOT EXISTS schema_version      INT NOT NULL DEFAULT 1;
ALTER TABLE course_study_sets ADD COLUMN IF NOT EXISTS content_fingerprint TEXT;
ALTER TABLE course_study_sets ADD COLUMN IF NOT EXISTS schema_version      INT NOT NULL DEFAULT 1;

-- Persistent bank of generated study items (flashcards/quiz/…). Unlike the
-- replaceable bundle in study_sets.data, the bank ACCUMULATES across refreshes
-- and is deduped by embedding similarity, so each refresh adds genuinely NEW
-- items instead of regenerating near-identical ones. Feeds excludeSeen on the
-- next generation. user_id NULL = sharable; scope_kind+scope_id locate the set.
CREATE TABLE IF NOT EXISTS study_items (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        REFERENCES users(id) ON DELETE CASCADE,
  scope_kind  TEXT        NOT NULL,            -- 'doc' | 'course'
  scope_id    UUID        NOT NULL,            -- syllabus_uploads.id | user_courses.id
  type        TEXT        NOT NULL,            -- 'flashcard' | 'quiz' | 'case' | 'cloze' | 'recall'
  topic_key   TEXT,                            -- normalized topic label (reuses mastery topic_key)
  difficulty  TEXT        NOT NULL DEFAULT 'medio',
  payload     JSONB       NOT NULL,            -- the item itself (front/back, question/options/…)
  dedupe_text TEXT        NOT NULL,            -- normalized text the embedding/dedupe is computed from
  embedding   vector(1536),                    -- text-embedding-3-small (same space as chunks)
  source      TEXT        NOT NULL DEFAULT 'study-gen',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_study_items_scope
  ON study_items (scope_kind, scope_id, type, topic_key);
CREATE INDEX IF NOT EXISTS idx_study_items_embedding
  ON study_items USING hnsw (embedding vector_cosine_ops);
