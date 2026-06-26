<p align="center">
  <h1 align="center">Navigator</h1>
  <p align="center">
    <strong>Your AI-powered academic assistant — upload your syllabus, ask anything, study with generated material.</strong>
  </p>
  <p align="center">
    <a href="#-features">Features</a> · <a href="#-how-it-works">How it works</a> · <a href="#-tech-stack">Stack</a>
  </p>
</p>

---

## The Problem

Students receive syllabi as PDFs and lose them in a folder. When exams arrive, they don't know which topics are prerequisites for others, which assessment comes first, or have personalized practice material. The information is there — but **it is not accessible, not interactive, and doesn't adapt to what each student needs to review.**

## The Solution

**Navigator** transforms any academic syllabus into a **complete learning system**:

1. **Upload your PDF** — Navigator parses it, chunks it, and generates vector embeddings.
2. **Ask the chat** — Answers grounded in the real syllabus content, with exact citations. No hallucinations.
3. **Visualize the knowledge map** — An editable graph of topics and prerequisites, generated automatically.
4. **Study with adaptive material** — Flashcards, quizzes, summaries, and mind maps generated from your material, with configurable difficulty and anti-repetition.
5. **Check your agenda** — Evaluations, weekly topics, and review recommendations crossing all your courses.

> A single app. A single deploy. Zero additional infrastructure.

---

## ✨ Features

| Feature | Description |
|---|---|
| **RAG Chat** | Questions about the syllabus with grounded answers and real PDF citations. Schedule-aware: knows which evaluations you have this week. |
| **Knowledge Graph** | AI-generated topic and prerequisite graph. Fully editable: add, rename, connect, and save nodes. Cycle-validated. |
| **Study Area** | 6 modes: flashcards (3D flip), dynamic quiz, simulation exam, review mode, mind map, and auto summary. Choose difficulty and topic. |
| **Smart Agenda** | Monthly calendar with events detected from the schedule. Per-day notes. Recommendations of what to review based on prerequisites. |
| **Multi-course** | The chat searches across all your courses. The agenda crosses evaluations. The study area focuses on your weakest topics. |
| **Guest Access** | Use the app without an account: the PDF is processed and auto-deleted in 24 h. Upon signup, data becomes permanent. |
| **SSE Streaming** | Real-time chat answers. Final event carries `title`, `citations`, `provider`, and `model`. |

---

## 🔍 How it Works

```
PDF → parse (unpdf) → chunks per page → embeddings (OpenAI) → pgvector (Neon)
                                                         ↓
                                          topic graph  (structured output)
                                          schedule     (structured output)
                                          study material (multi-agent)
                                                         ↓
Chat: question → embed → cosine similarity → hybrid rerank → context + agenda → LLM → SSE
```

**Everything lives in a single full-stack Next.js app.** No separate backend, no Python, no Docker in production. The entire RAG pipeline (ingestion, embeddings, retrieval, generation) is implemented in TypeScript and runs as Next.js API routes.

Ingestion is **async in 2 phases**: the upload responds immediately; a durable job queue (`FOR UPDATE SKIP LOCKED`) processes embeddings and generates the graph/schedule in the background with retries and exponential backoff.

<p align="center">
  <img src="./rag-architecture.png" alt="Navigator RAG Architecture" width="900"/>
</p>

### RAG Pipeline Layers

| Layer | What it does |
|---|---|
| **Ingestion (sync)** | PDF parsing (`unpdf`), chunking by page (1200 chars / 120 overlap), magic bytes validation, SHA-256 hash. Stores text in Neon — no embeddings yet. |
| **Async Worker** | Reads pending chunks → batch embeddings (`text-embedding-3-small`, 1536d) → pgvector HNSW. Then: generates topic graph (structured output + DFS cycle validation) and evaluation schedule. |
| **Multi-index** | Dense (pgvector `<=>`) + hybrid lexical (`tsvector` GIN + RRF) for topic-based retrieval. Covers the full syllabus, not just the first 24 k chars. |
| **Retrieval** | Over-fetch K=24 candidates → relevance gate (cosine > 0.9 → no context injected) → vector + lexical rerank → top-8 chunks with citations (page / char offset). |
| **Study Agents** | Adaptive router (exam weight × domain mastery × schedule urgency) → TS graph orchestrator → specialized agents (flashcard, inquisitor, synth) → different-family verifier → item bank with embedding-based dedup. |
| **Chat Generation** | RAG context + agenda block (all courses) + 6-turn history → `GROUNDED_SYSTEM_PROMPT` (student mentor) → `chatStream` SSE. Final event: `title`, `citations`, `provider`, `model`. |
| **Job Queue** | Atomic claim (`FOR UPDATE SKIP LOCKED`), exponential backoff `2^attempts`, stuck-job rescue (> 10 min), fire-and-forget on upload + backup cron. |

---

## 🏗 Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 14 (App Router), React 18, TypeScript strict |
| **Database** | Neon serverless Postgres + pgvector (embeddings 1536d, HNSW) |
| **Auth** | NextAuth v5, bcryptjs, RBAC roles (`guest → free → pro → admin`) |
| **LLM** | OpenAI SDK + OpenRouter (fallback by tier). GPT-4o-mini default. |
| **Graph UI** | `@xyflow/react` (editable: add / rename / delete / connect) |
| **UI** | Tailwind CSS 4, shadcn/ui (Radix / base-ui), Lucide icons, Sonner toasts |
| **Validation** | Zod (server) + react-hook-form (client) |
| **PDF** | `unpdf` (in-process text extraction, no native deps) |
| **Cache / Rate limit** | Upstash Redis (optional; in-memory fallback per instance) |
| **CI** | GitHub Actions (typecheck + 197 Vitest tests) |
| **Deploy** | Vercel (single app) |

---

<p align="center">
  <sub>Built with Next.js, OpenAI, pgvector, and many late-night coffee sessions. ☕</sub>
</p>
