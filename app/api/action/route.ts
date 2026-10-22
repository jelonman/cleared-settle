import { perform, rateLimited } from "@/lib/service";
import { PaypalError } from "@/lib/paypal";
export const maxDuration = 60;
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  if (rateLimited(ip)) return Response.json({ error: "Too many requests. Wait a few minutes." }, { status: 429 });
  const { action, entry } = await req.json().catch(() => ({}));
  if (!action || !["invoice", "refund", "payout"].includes(action.kind)) return Response.json({ error: "Unknown action." }, { status: 400 });
  try {
    return Response.json(await perform(action, entry));
  } catch (e) {
    if (e instanceof PaypalError) return Response.json({ error: e.message, paypal: e.body }, { status: e.status >= 400 && e.status < 600 ? e.status : 502 });
    return Response.json({ error: e instanceof Error ? e.message : "Action failed." }, { status: 400 });
  }
}
