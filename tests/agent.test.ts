import { describe, it, expect } from "vitest";
import { validateReply, runAgent } from "../lib/agent";
import * as F from "./fixtures";

describe("agent validation: the model proposes, the code decides", () => {
  const existing = [F.entry()];
  it("accepts a clean reply", () => {
    const r = validateReply({
      entries: [{ item: "Vintage Seiko watch", platform: "direct", date: "2026-10-21", salePrice: 120, shippingCharged: 8, cost: 40, shipCost: 6, buyerName: "Ana", buyerEmail: "ana@example.com" }],
      actions: [{ kind: "invoice", entryRef: "Vintage Seiko watch", reason: "Local buyer, pays by PayPal" }, { kind: "refund", entryRef: "e_1", amount: 10, reason: "Small stain" }, { kind: "payout", receiver: "mum@example.com", amount: 30, reason: "Her share" }],
    }, existing, "2026-10-22");
    expect(r.entries).toHaveLength(1); expect(r.actions.map((a) => a.kind)).toEqual(["invoice", "refund", "payout"]); expect(r.dropped).toEqual([]);
  });
  it("drops invented references, bad payouts and invoices for marketplace sales", () => {
    const r = validateReply({
      entries: [{ item: "Nike hoodie", platform: "poshmark", salePrice: 30, buyerEmail: "x@example.com" }, { item: "", salePrice: 5 }],
      actions: [{ kind: "refund", entryRef: "ghost item", reason: "" }, { kind: "payout", receiver: "not-an-email", amount: 5, reason: "" }, { kind: "invoice", entryRef: "Nike hoodie", reason: "" }, { kind: "wire", entryRef: "e_1", reason: "" }],
    }, existing, "2026-10-22");
    expect(r.actions).toHaveLength(0); expect(r.dropped.length).toBe(5);
  });
  it("runAgent uses the chat endpoint and survives a code-fenced reply", async () => {
    const reply = { choices: [{ message: { content: "```json\n" + JSON.stringify({ entries: [{ item: "Camera", platform: "ebay", salePrice: 80 }], actions: [] }) + "\n```" } }] };
    const fetchFn = (async () => new Response(JSON.stringify(reply))) as unknown as typeof fetch;
    const r = await runAgent("sold a camera on ebay for 80", [], "2026-10-22", { apiKey: "k", fetch: fetchFn });
    expect(r.entries[0]).toMatchObject({ item: "Camera", platform: "ebay", date: "2026-10-22" });
  });
});
