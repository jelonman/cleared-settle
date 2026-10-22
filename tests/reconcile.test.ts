import { describe, it, expect } from "vitest";
import { reconcile } from "../lib/reconcile";
import { sampleTape } from "../lib/sample";
import * as F from "./fixtures";

const est = () => 1.2;
describe("reconcile", () => {
  it("matches by invoice number and reads the real fee", () => {
    const e = F.entry({ paypal: { invoiceNumber: "CS-1" }, status: "invoiced" });
    const r = reconcile([e], [F.tx("TX1", "48.00", "-1.77", { invoice_id: "CS-1" }, "sam@example.com")], est);
    expect(r.matched[0]).toMatchObject({ entryId: "e_1", transactionId: "TX1", by: "invoice", gross: 48, fee: 1.77, net: 46.23, feeDelta: 0.57 });
    expect(r.totals).toEqual({ gross: 48, fees: 1.77, net: 46.23 });
  });
  it("falls back to custom_field, then to a unique payer+amount", () => {
    const a = F.entry({ id: "e_a" }), b = F.entry({ id: "e_b", buyerEmail: "kim@example.com", salePrice: 20, shippingCharged: 0 });
    const r = reconcile([a, b], [F.tx("T1", "48.00", "-1.00", { custom_field: "e_a" }), F.tx("T2", "20.00", "-0.50", {}, "kim@example.com")], est);
    expect(r.matched.map((m) => [m.entryId, m.by])).toEqual([["e_a", "custom"], ["e_b", "amount"]]);
  });
  it("does not guess when two payments could fit", () => {
    const b = F.entry({ id: "e_b" });
    const r = reconcile([b], [F.tx("T1", "48.00", "-1", {}, "sam@example.com"), F.tx("T2", "48.00", "-1", {}, "sam@example.com")], est);
    expect(r.matched).toHaveLength(0); expect(r.waiting).toEqual(["e_b"]); expect(r.unknownPayments).toHaveLength(2);
  });
  it("links a refund row to its payment through paypal_reference_id", () => {
    const e = F.entry({ paypal: { invoiceNumber: "CS-1" } });
    const r = reconcile([e], [F.tx("TX1", "48.00", "-1.77", { invoice_id: "CS-1" }), F.tx("TXR", "-48.00", undefined, { paypal_reference_id: "TX1" })], est);
    expect(r.refunded).toEqual([{ entryId: "e_1", transactionId: "TXR", amount: 48 }]);
    expect(r.unknownRefunds).toHaveLength(0);
  });
  it("flags unknown money and pending payments", () => {
    const e = F.entry({ paypal: { invoiceNumber: "CS-1" } });
    const r = reconcile([e], [F.tx("TX1", "48.00", "-1.77", { invoice_id: "CS-1", transaction_status: "P" }), F.tx("TX9", "18.00", "-1.12")], est);
    expect(r.pending).toEqual(["e_1"]); expect(r.unknownPayments[0].transactionId).toBe("TX9");
  });
  it("marketplace sales are never expected on the PayPal tape", () => {
    const r = reconcile([F.entry({ platform: "poshmark" })], [], est);
    expect(r.waiting).toEqual([]);
  });
  it("sample tape produces matches plus one unknown payment", () => {
    const e = F.entry({ paypal: { invoiceNumber: "CS-1" }, status: "invoiced" });
    const r = reconcile([e], sampleTape([e]), est);
    expect(r.matched).toHaveLength(1); expect(r.unknownPayments).toHaveLength(1);
  });
});
