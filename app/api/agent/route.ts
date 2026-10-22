import { runAgent } from "@/lib/agent";
import { llmConfigured } from "@/lib/llm";
import { rateLimited } from "@/lib/service";
export const maxDuration = 60;
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  if (rateLimited(ip)) return Response.json({ error: "Too many requests. Wait a few minutes." }, { status: 429 });
  const { text, entries } = await req.json().catch(() => ({}));
  if (typeof text !== "string" || !text.trim()) return Response.json({ error: "Write a few lines about your sales first." }, { status: 400 });
  if (!llmConfigured()) return Response.json({ error: "The language step needs LLM_API_KEY on the server." }, { status: 503 });
  try {
    const today = new Date().toISOString().slice(0, 10);
    return Response.json(await runAgent(text, Array.isArray(entries) ? entries : [], today));
  } catch (e) {
    return Response.json({ error: "The agent could not read that. Try again, or add the sale by hand." }, { status: 502 });
  }
}
