CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS programs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id UUID REFERENCES programs(id) ON DELETE SET NULL,
  code TEXT,
  name TEXT NOT NULL,
  term TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, term)
);

CREATE TABLE IF NOT EXISTS syllabi (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  source_file_url TEXT,
  source_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course_id, version),
  UNIQUE (source_hash)
);

CREATE TABLE IF NOT EXISTS topics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  syllabus_id UUID NOT NULL REFERENCES syllabus_uploads(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  weight_percent NUMERIC(5,2) CHECK (weight_percent >= 0 AND weight_percent <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (syllabus_id, external_id)
);

CREATE TABLE IF NOT EXISTS topic_dependencies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  syllabus_id UUID NOT NULL REFERENCES syllabus_uploads(id) ON DELETE CASCADE,
  prerequisite_topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  target_topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'prerequisite',
  confidence NUMERIC(4,3) CHECK (confidence >= 0 AND confidence <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (prerequisite_topic_id <> target_topic_id),
  UNIQUE (prerequisite_topic_id, target_topic_id, relation_type)
);

-- MVP RAG uploads (Option A: parallel to graph schema syllabi/topics until Sprint 2)
CREATE TABLE IF NOT EXISTS syllabus_uploads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  graph_status TEXT NOT NULL DEFAULT 'pending',
  graph_error TEXT,
  graph_generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_hash)
);

CREATE INDEX IF NOT EXISTS idx_syllabus_uploads_user_id ON syllabus_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_syllabus_uploads_status ON syllabus_uploads(status);

-- Chat threads (one per conversation)
CREATE TABLE IF NOT EXISTS chats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New chat',
  active_model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);

-- Individual messages within a chat
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','ai')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
