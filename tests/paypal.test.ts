import { describe, it, expect } from "vitest";
import { getAccessToken, buildInvoice, buildRefund, buildPayout, createAndSendInvoice, refundCapture, createPayout, searchTransactions, invoiceIdFromHref, generateInvoiceNumber, PaypalError } from "../lib/paypal";
import { loadSpec, validate, requestSchema, responseSchema } from "./openapi";
import * as F from "./fixtures";

const calls: { url: string; init: any }[] = [];
function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  return (async (url: string, init: any) => {
    calls.push({ url, init });
    const key = `${init?.method ?? "GET"} ${new URL(url).pathname}`;
    const r = routes[key] ?? { status: 404, body: { name: "NOT_FOUND" } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
}
const creds = { clientId: "id", clientSecret: "secret", base: "https://api-m.sandbox.paypal.com" };

describe("request builders match PayPal's official OpenAPI schemas", () => {
  const inv = loadSpec("invoicing_v2.json"), pay = loadSpec("payments_payment_v2.json"), po = loadSpec("payments_payouts_batch_v1.json");
  it("invoice create body", () => {
    const body = buildInvoice(F.entry({ salePrice: 42, shippingCharged: 6 }), "CS-20261020-ab12", { businessName: "Pete's Vintage", merchantEmail: "merchant@example.com" });
    expect(validate(inv, requestSchema(inv, "/v2/invoicing/invoices", "post"), body)).toEqual([]);
    expect(body.items[0].unit_amount).toEqual({ currency_code: "USD", value: "42.00" });
  });
  it("invoice send body", () => {
    const body = { subject: "Invoice", send_to_recipient: true, send_to_invoicer: false };
    expect(validate(inv, requestSchema(inv, "/v2/invoicing/invoices/{invoice_id}/send", "post"), body)).toEqual([]);
  });
  it("full and partial refund bodies", () => {
    const e = F.entry({ paypal: { invoiceNumber: "CS-1" } });
    const s = requestSchema(pay, "/v2/payments/captures/{capture_id}/refund", "post");
    expect(validate(pay, s, buildRefund(e, undefined, "Item not as described"))).toEqual([]);
    const part = buildRefund(e, 10, "Partial");
    expect(part.amount).toEqual({ currency_code: "USD", value: "10.00" });
    expect(validate(pay, s, part)).toEqual([]);
    expect(buildRefund(e, 48).amount).toBeUndefined(); // full amount means send no amount
  });
  it("payout body uses currency, not currency_code", () => {
    const body = buildPayout("cs-a_1", "consignor@example.com", 25.5, "Consignment share");
    expect(validate(po, requestSchema(po, "/v1/payments/payouts", "post"), body)).toEqual([]);
    expect(body.items[0].amount).toEqual({ currency: "USD", value: "25.50" });
  });
  it("fixtures match the documented responses", () => {
    expect(validate(pay, responseSchema(pay, "/v2/payments/captures/{capture_id}/refund", "post", "201"), F.refundCreated)).toEqual([]);
    expect(validate(po, responseSchema(po, "/v1/payments/payouts", "post", "201"), F.payoutCreated)).toEqual([]);
    expect(validate(inv, responseSchema(inv, "/v2/invoicing/invoices", "post", "201"), F.invoiceCreated)).toEqual([]);
  });
  it("the validator really rejects bad shapes", () => {
    const s = requestSchema(po, "/v1/payments/payouts", "post");
    const bad = buildPayout("x", "a@b.co", 1, "n") as any; bad.items[0].amount = { currency_code: "USD", value: "1.00" };
    expect(validate(po, s, bad).length).toBeGreaterThan(0);
  });
});

describe("client calls", () => {
  it("token: basic auth + client_credentials form", async () => {
    calls.length = 0;
    const t = await getAccessToken({ ...creds, fetch: fakeFetch({ "POST /v1/oauth2/token": { body: F.tokenResponse } }) });
    expect(t).toBe(F.tokenResponse.access_token);
    expect(calls[0].init.headers.authorization).toBe("Basic " + Buffer.from("id:secret").toString("base64"));
    expect(calls[0].init.body).toBe("grant_type=client_credentials");
  });
  it("rejects bad credentials with a typed error", async () => {
    await expect(getAccessToken({ ...creds, fetch: fakeFetch({ "POST /v1/oauth2/token": { status: 401, body: { error: "invalid_client" } } }) })).rejects.toBeInstanceOf(PaypalError);
  });
  it("invoice: create (representation) then send", async () => {
    calls.length = 0;
    const r = await createAndSendInvoice(F.entry(), "CS-1", { ...creds, fetch: fakeFetch({ "POST /v1/oauth2/token": { body: F.tokenResponse }, "POST /v2/invoicing/invoices": { status: 201, body: F.invoiceCreated }, "POST /v2/invoicing/invoices/INV2-Z56S-5LLA-Q52L-CPZ5/send": { body: F.invoiceSent } }) });
    expect(r.invoiceId).toBe("INV2-Z56S-5LLA-Q52L-CPZ5");
    expect(calls[1].init.headers.prefer).toBe("return=representation");
  });
  it("invoice id falls back to the href link", () => {
    expect(invoiceIdFromHref(F.invoiceCreated.links[0].href)).toBe("INV2-Z56S-5LLA-Q52L-CPZ5");
  });
  it("invoice number generator", async () => {
    expect(await generateInvoiceNumber({ ...creds, fetch: fakeFetch({ "POST /v1/oauth2/token": { body: F.tokenResponse }, "POST /v2/invoicing/generate-next-invoice-number": { body: F.nextInvoiceNumber } }) })).toBe("0001");
  });
  it("refund needs a transaction id, then posts to captures/{id}/refund", async () => {
    await expect(refundCapture(F.entry(), undefined, "x", { ...creds, fetch: fakeFetch({}) })).rejects.toThrow(/reconcile/);
    const r = await refundCapture(F.entry({ paypal: { transactionId: "3C679366HH908993F" } }), 10.99, "Defective", { ...creds, fetch: fakeFetch({ "POST /v1/oauth2/token": { body: F.tokenResponse }, "POST /v2/payments/captures/3C679366HH908993F/refund": { status: 201, body: F.refundCreated } }) });
    expect(r).toMatchObject({ refundId: "1JU08902781691411", status: "COMPLETED" });
  });
  it("payout returns batch id and status", async () => {
    const r = await createPayout("cs-a_1", "c@example.com", 5, "n", { ...creds, fetch: fakeFetch({ "POST /v1/oauth2/token": { body: F.tokenResponse }, "POST /v1/payments/payouts": { status: 201, body: F.payoutCreated } }) });
    expect(r).toEqual({ payoutBatchId: "5UXD6M9QYW2QL", batchStatus: "PENDING" });
  });
  it("transaction search pages through results and windows long ranges", async () => {
    calls.length = 0;
    const f = (async (url: string, init: any) => {
      calls.push({ url, init });
      const u = new URL(url);
      if (u.pathname.endsWith("/oauth2/token")) return new Response(JSON.stringify(F.tokenResponse));
      const page = Number(u.searchParams.get("page"));
      return new Response(JSON.stringify({ transaction_details: [F.tx(`T${calls.length}`, "10.00", "-0.84")], page, total_pages: 2, total_items: 2 }));
    }) as unknown as typeof fetch;
    const rows = await searchTransactions("2026-08-01T00:00:00Z", "2026-10-01T00:00:00Z", { ...creds, fetch: f });
    const searches = calls.filter((c) => c.url.includes("/reporting/transactions"));
    expect(searches.length).toBeGreaterThanOrEqual(4); // >= 2 windows x 2 pages
    for (const c of searches) {
      const u = new URL(c.url); expect(u.searchParams.get("start_date")).toMatch(/Z$/);
      expect(Date.parse(u.searchParams.get("end_date")!) - Date.parse(u.searchParams.get("start_date")!)).toBeLessThanOrEqual(31 * 86400_000);
    }
    expect(rows.length).toBe(searches.length);
  });
});
