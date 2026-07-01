// Live retrieval sanity: embed real queries, measure cosine distances vs the gate (0.9).
import { config } from "dotenv"
config({ path: ".env.local" })
import { neon } from "@neondatabase/serverless"

// Which keys exist locally (names only, no values)
const KEYS = [
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "BLUESMIND_API_KEY",
  "BLUESMIND_BASE_URL",
  "MODEL_RAG",
  "RAG_MAX_DISTANCE",
]
console.log("env presence:", KEYS.map((k) => `${k}=${process.env[k] ? "SET" : "MISSING"}`).join(" "))

const sql = neon(process.env.DATABASE_URL)

async function embed(text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-large", input: [text], dimensions: 2000 }),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
  return (await res.json()).data[0].embedding
}

const queries = [
  "what is database normalization?",             // on-topic, cross-language (EN vs ES content)
  "explícame el modelo entidad-relación",        // on-topic core
  "qué temas hay esta semana",                   // on-topic vague/schedule
  "SELECT con JOIN en SQL",                      // on-topic exact terms
  "¿quién ganó el mundial de fútbol 2022?",      // off-topic
  "recomiéndame una película romántica",         // off-topic
  "cómo invertir en criptomonedas",              // off-topic
]

for (const q of queries) {
  const v = `[${(await embed(q)).join(",")}]`
  const rows = await sql`
    SELECT su.original_filename, c.embedding <=> ${v}::vector AS d
    FROM chunks c JOIN syllabus_uploads su ON su.id = c.syllabus_id
    WHERE c.embedding IS NOT NULL
    ORDER BY d ASC LIMIT 3`
  console.log(`\nQ: ${q}`)
  for (const r of rows) console.log(`   d=${Number(r.d).toFixed(3)}  ${r.original_filename}`)
}
