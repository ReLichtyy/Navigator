// Minimal Bluesmind gateway probe: status + body + rate headers.
import { config } from "dotenv"
config({ path: ".env.local" })

const res = await fetch(`${process.env.BLUESMIND_BASE_URL}/chat/completions`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.BLUESMIND_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: process.env.MODEL_RAG || "gpt-5.4",
    messages: [{ role: "user", content: "Reply with the single word: ok" }],
  }),
})
console.log("status:", res.status)
for (const [k, v] of res.headers.entries()) {
  if (/rate|retry|limit|quota/i.test(k)) console.log(`header ${k}: ${v}`)
}
const text = await res.text()
console.log("body:", text.slice(0, 600))
