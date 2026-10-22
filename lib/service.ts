// One place that decides: live sandbox call when the two keys exist, otherwise a request preview.
// A preview is the exact request we would send. It is labelled as such and never presented as a result.
import { paypalConfigured, buildInvoice, buildRefund, buildPayout, createAndSendInvoice, refundCapture, createPayout, generateInvoiceNumber, SANDBOX_BASE, type PaypalOptions } from "./paypal";
import type { LedgerEntry, ProposedAction } from "./types";

export type ActionResult =
  | { mode: "preview"; method: string; path: string; body: unknown; note: string }
  | { mode: "live"; kind: string; refs: Record<string, string | undefined>; detail: string };

const NEEDS_KEYS = "Preview only. This request was NOT sent. Live PayPal calls need the sandbox keys (PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET) on the server.";

export async function perform(a: ProposedAction, e: LedgerEntry | undefined, o: PaypalOptions = {}): Promise<ActionResult> {
  const live = paypalConfigured(o);
  if (a.kind === "invoice") {
    if (!e) throw new Error("Invoice needs a ledger entry.");
    const num = e.paypal.invoiceNumber ?? (live ? await generateInvoiceNumber(o) : `CS-${e.date.replace(/-/g, "")}-${e.id.slice(2, 6)}`.slice(0, 25));
    if (!live) return { mode: "preview", method: "POST", path: `${SANDBOX_BASE}/v2/invoicing/invoices`, body: buildInvoice(e, num), note: NEEDS_KEYS };
    const r = await createAndSendInvoice(e, num, o);
    return { mode: "live", kind: "invoice", refs: { invoiceId: r.invoiceId, invoiceNumber: r.invoiceNumber }, detail: `Invoice ${r.invoiceNumber} created and sent (HTTP ${r.sendStatus}).` };
  }
  if (a.kind === "refund") {
    if (!e) throw new Error("Refund needs a ledger entry.");
    if (!live) return { mode: "preview", method: "POST", path: `${SANDBOX_BASE}/v2/payments/captures/${e.paypal.transactionId ?? "{capture_id from reconcile}"}/refund`, body: buildRefund(e, a.amount, a.reason), note: NEEDS_KEYS };
    const r = await refundCapture(e, a.amount, a.reason, o);
    return { mode: "live", kind: "refund", refs: { refundId: r.refundId }, detail: `Refund ${r.refundId} ${r.status}${r.amount ? " " + r.amount.value + " " + r.amount.currency_code : ""}.` };
  }
  const batch = `cs-${a.id}`;
  const amount = a.amount ?? 0;
  if (!live) return { mode: "preview", method: "POST", path: `${SANDBOX_BASE}/v1/payments/payouts`, body: buildPayout(batch, a.receiver ?? "", amount, a.note ?? a.reason), note: NEEDS_KEYS };
  const r = await createPayout(batch, a.receiver ?? "", amount, a.note ?? a.reason, o);
  return { mode: "live", kind: "payout", refs: { payoutBatchId: r.payoutBatchId }, detail: `Payout batch ${r.payoutBatchId} is ${r.batchStatus}.` };
}

// Simple per-IP limiter so a public sandbox demo cannot be used as a free request cannon.
const hits = new Map<string, number[]>();
export function rateLimited(ip: string, max = 30, windowMs = 10 * 60_000) {
  const now = Date.now(); const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(ip, arr); return arr.length > max;
}
