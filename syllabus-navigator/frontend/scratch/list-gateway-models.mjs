import { config } from "dotenv"
config({ path: ".env.local" })
const res = await fetch(`${process.env.BLUESMIND_BASE_URL}/models`, {
  headers: { Authorization: `Bearer ${process.env.BLUESMIND_API_KEY}` },
})
console.log("status:", res.status)
const data = await res.json().catch(() => null)
const ids = data?.data?.map((m) => m.id) ?? data
console.log(JSON.stringify(ids, null, 1))
