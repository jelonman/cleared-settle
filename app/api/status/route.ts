import { paypalConfigured } from "@/lib/paypal";
import { llmConfigured } from "@/lib/llm";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({ paypal: paypalConfigured(), llm: llmConfigured(), environment: "sandbox" });
}
