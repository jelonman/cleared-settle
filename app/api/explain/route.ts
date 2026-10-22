import { chatJson, llmConfigured } from "@/lib/llm";
import { EXPLAIN_SYSTEM } from "@/lib/agent";
import { rateLimited } from "@/lib/service";
export const maxDuration = 60;
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  if (rateLimited(ip)) return Response.json({ error: "Too many requests." }, { status: 429 });
  const { result } = await req.json().catch(() => ({}));
  if (!result || !llmConfigured()) return Response.json({ summary: null, todo: [] });
  try {
    const slim = { matched: result.matched?.length, waiting: result.waiting?.length, pending: result.pending?.length, refunded: result.refunded?.length, unknownPayments: result.unknownPayments, unknownRefunds: result.unknownRefunds, feeDeltas: result.matched?.map((m: any) => m.feeDelta), totals: result.totals };
    return Response.json(await chatJson<{ summary: string; todo: string[] }>(EXPLAIN_SYSTEM, JSON.stringify(slim)));
  } catch { return Response.json({ summary: null, todo: [] }); }
}
