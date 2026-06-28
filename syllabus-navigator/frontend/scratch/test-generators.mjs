import { config } from "dotenv"
config({ path: ".env.local" })
import { register } from "node:module"
import { pathToFileURL } from "node:url"
// use tsx loader if available; else fall back to manual gateway call
import { neon } from "@neondatabase/serverless"
const sql = neon(process.env.DATABASE_URL)
const key = process.env.BLUESMIND_API_KEY, base = process.env.BLUESMIND_BASE_URL
const rows = await sql`SELECT content FROM chunks WHERE syllabus_id = (SELECT id FROM syllabus_uploads WHERE status='processed' ORDER BY created_at DESC LIMIT 1) ORDER BY chunk_index LIMIT 30`
const text = rows.map(r => r.content).join("\n\n").slice(0, 8000)
function extractJson(raw){const f=raw.match(/```(?:json)?\s*([\s\S]*?)```/i);if(f)return f[1].trim();const a=raw.indexOf("{"),b=raw.lastIndexOf("}");return a>=0&&b>a?raw.slice(a,b+1):raw.trim()}
async function gw(sys,user){const r=await fetch(base.replace(/\/$/,"")+"/chat/completions",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-5.4",messages:[{role:"system",content:sys+"\n\nRespond ONLY with a single valid JSON object. No prose, no fences."},{role:"user",content:user}]})});const j=await r.json();if(!r.ok)throw new Error(JSON.stringify(j.error));return j.choices[0].message.content}
// graph
const g=JSON.parse(extractJson(await gw('Extract topics. JSON shape: {"nodes":[{"id":string,"label":string,"weight":number,"dependencies":string[]}]}',"Syllabus:\n"+text)))
console.log("GRAPH nodes:",g.nodes?.length)
// schedule
const s=JSON.parse(extractJson(await gw('Extract cronograma. JSON shape: {"events":[{"type":string,"title":string,"description":string,"date":string,"week_label":string,"weight_percent":number}]}',"Syllabus:\n"+text)))
console.log("SCHEDULE events:",s.events?.length)
// course infer
const c=JSON.parse(extractJson(await gw('Classify into a course. JSON shape: {"matched_course_id":string|null,"suggested_name":string,"confidence":number,"subject_tags":string[]}','filename: silabo.pdf\nExcerpt:\n'+text)))
console.log("INFER:",c.suggested_name, c.confidence)
// study
const st=JSON.parse(extractJson(await gw('Generate study aids. JSON shape: {"flashcards":[{"front":string,"back":string}],"quiz":[{"question":string,"options":string[],"answer":number,"explanation":string}],"summary":{"intro":string,"points":[{"title":string,"body":string}]},"mindmap":{"center":string,"branches":[{"label":string,"children":string[]}]}}',"Content:\n"+text)))
console.log("STUDY flashcards:",st.flashcards?.length,"quiz:",st.quiz?.length)
console.log("ALL GENERATORS OK")
