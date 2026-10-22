// Deterministic matching of ledger entries to PayPal Transaction Search rows.
// No model is involved here; the AI only explains the result afterwards.
import type { LedgerEntry } from "./types";
import type { TransactionDetail } from "./paypal";

export interface Match { entryId: string; transactionId: string; by: "invoice" | "custom" | "amount"; gross: number; fee: number; net: number; estimatedFee?: number; feeDelta?: number }
export interface Refunded { entryId: string; transactionId: string; amount: number }
export interface Reconciliation {
  matched: Match[];
  refunded: Refunded[];
  waiting: string[]; // ledger entries expecting a PayPal payment that is not in the data yet
  pending: string[]; // matched but transaction_status is not S
  unknownPayments: { transactionId: string; amount: number; payer?: string; subject?: string }[];
  unknownRefunds: { transactionId: string; amount: number }[];
  totals: { gross: number; fees: number; net: number };
}

const num = (v?: string) => (v === undefined || v === "" ? 0 : Number(v));
const r2 = (n: number) => Math.round(n * 100) / 100;
export const expectedGross = (e: LedgerEntry) => r2(e.salePrice + e.shippingCharged);

export function reconcile(entries: LedgerEntry[], txs: TransactionDetail[], estimateFee: (e: LedgerEntry) => number): Reconciliation {
  const out: Reconciliation = { matched: [], refunded: [], waiting: [], pending: [], unknownPayments: [], unknownRefunds: [], totals: { gross: 0, fees: 0, net: 0 } };
  const payments = txs.filter((t) => num(t.transaction_info.transaction_amount?.value) > 0);
  const negatives = txs.filter((t) => num(t.transaction_info.transaction_amount?.value) < 0);
  const used = new Set<string>();
  const payOf = (e: LedgerEntry) => e.paypal.invoiceNumber || e.status === "invoiced" || e.status === "paid" || e.platform === "direct";

  for (const e of entries.filter(payOf)) {
    let hit: TransactionDetail | undefined; let by: Match["by"] = "amount";
    if (e.paypal.invoiceNumber) { hit = payments.find((t) => !used.has(t.transaction_info.transaction_id) && t.transaction_info.invoice_id === e.paypal.invoiceNumber); by = "invoice"; }
    if (!hit) { hit = payments.find((t) => !used.has(t.transaction_info.transaction_id) && t.transaction_info.custom_field === e.id); by = "custom"; }
    if (!hit && e.buyerEmail) {
      const c = payments.filter((t) => !used.has(t.transaction_info.transaction_id) && t.payer_info?.email_address?.toLowerCase() === e.buyerEmail!.toLowerCase() && Math.abs(num(t.transaction_info.transaction_amount?.value) - expectedGross(e)) < 0.005);
      if (c.length === 1) { hit = c[0]; by = "amount"; }
    }
    if (!hit) { out.waiting.push(e.id); continue; }
    const ti = hit.transaction_info; used.add(ti.transaction_id);
    const gross = num(ti.transaction_amount?.value); const fee = Math.abs(num(ti.fee_amount?.value));
    const est = estimateFee(e);
    out.matched.push({ entryId: e.id, transactionId: ti.transaction_id, by, gross, fee, net: r2(gross - fee), estimatedFee: est, feeDelta: r2(fee - est) });
    if (ti.transaction_status && ti.transaction_status !== "S") out.pending.push(e.id);
    out.totals.gross += gross; out.totals.fees += fee;
  }
  for (const t of payments) if (!used.has(t.transaction_info.transaction_id)) {
    const ti = t.transaction_info;
    out.unknownPayments.push({ transactionId: ti.transaction_id, amount: num(ti.transaction_amount?.value), payer: t.payer_info?.email_address, subject: ti.transaction_subject });
  }
  // A refund row points at the payment it reverses through paypal_reference_id.
  for (const t of negatives) {
    const ti = t.transaction_info; const m = out.matched.find((x) => x.transactionId === ti.paypal_reference_id);
    if (m) out.refunded.push({ entryId: m.entryId, transactionId: ti.transaction_id, amount: Math.abs(num(ti.transaction_amount?.value)) });
    else out.unknownRefunds.push({ transactionId: ti.transaction_id, amount: Math.abs(num(ti.transaction_amount?.value)) });
  }
  out.totals = { gross: r2(out.totals.gross), fees: r2(out.totals.fees), net: r2(out.totals.gross - out.totals.fees) };
  return out;
}
