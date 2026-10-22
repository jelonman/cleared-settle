import { paypalConfigured, searchTransactions, PaypalError, SANDBOX_BASE } from "@/lib/paypal";
import { reconcile } from "@/lib/reconcile";
import { sampleTape } from "@/lib/sample";
import { computeBreakdown } from "@/lib/fees";
import { rateLimited } from "@/lib/service";
import type { LedgerEntry } from "@/lib/types";
export const maxDuration = 60;

// Assumed PayPal rate (3.49% + $0.49) used only as an estimate. Reconcile replaces it with the real fee_amount.
const estimate = (e: LedgerEntry) => computeBreakdown({ salePrice: e.salePrice, shippingCharged: e.shippingCharged, fee: { percent: 3.49, fixed: 0.49 } }).fees;

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  if (rateLimited(ip)) return Response.json({ error: "Too many requests. Wait a few minutes." }, { status: 429 });
  const { entries, sample } = await req.json().catch(() => ({}));
  if (!Array.isArray(entries)) return Response.json({ error: "Send the ledger entries." }, { status: 400 });
  const end = new Date(); const start = new Date(end.getTime() - 60 * 86400_000);
  const q = `${SANDBOX_BASE}/v1/reporting/transactions?start_date=${start.toISOString().slice(0, 19)}Z&end_date=${end.toISOString().slice(0, 19)}Z&fields=transaction_info,payer_info&page_size=100`;
  if (paypalConfigured()) {
    try {
      const txs = await searchTransactions(start.toISOString(), end.toISOString());
      return Response.json({ source: "paypal-sandbox", count: txs.length, result: reconcile(entries, txs, estimate) });
    } catch (e) {
      if (e instanceof PaypalError) return Response.json({ error: e.message, paypal: e.body }, { status: e.status >= 400 && e.status < 600 ? e.status : 502 });
      return Response.json({ error: "Reconcile failed." }, { status: 500 });
    }
  }
  if (sample) {
    const txs = sampleTape(entries);
    return Response.json({ source: "sample", count: txs.length, result: reconcile(entries, txs, estimate) });
  }
  return Response.json({ source: "none", note: "Live reconcile needs the PayPal sandbox keys. Nothing was requested.", request: { method: "GET", url: q } }, { status: 200 });
}
