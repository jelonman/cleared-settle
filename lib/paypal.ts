// PayPal REST client for the sandbox. Every endpoint and field below is taken from PayPal's
// official OpenAPI files (github.com/paypal/paypal-rest-api-specifications, main @ 2026-04-07)
// and cross-checked against developer.paypal.com. Doc URL sits next to each call.
// Two env vars: PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET. Base URL is the sandbox only.
import type { LedgerEntry, Money } from "./types";

export const SANDBOX_BASE = "https://api-m.sandbox.paypal.com";

export class PaypalError extends Error {
  constructor(public status: number, public body: unknown, m: string) { super(m); }
}

export interface PaypalOptions { clientId?: string; clientSecret?: string; base?: string; fetch?: typeof fetch }

export function paypalConfigured(o: PaypalOptions = {}) {
  return Boolean((o.clientId ?? process.env.PAYPAL_CLIENT_ID ?? "").trim() && (o.clientSecret ?? process.env.PAYPAL_CLIENT_SECRET ?? "").trim());
}

const money = (n: number, cur = "USD"): Money => ({ currency_code: cur, value: n.toFixed(2) });

let cached: { token: string; exp: number } | null = null;

/** Auth: POST /v1/oauth2/token, HTTP Basic client_id:secret, body grant_type=client_credentials.
 *  Response: { access_token, token_type: "Bearer", expires_in }.
 *  https://developer.paypal.com/api/rest/authentication/ */
export async function getAccessToken(o: PaypalOptions = {}): Promise<string> {
  const id = (o.clientId ?? process.env.PAYPAL_CLIENT_ID ?? "").trim();
  const secret = (o.clientSecret ?? process.env.PAYPAL_CLIENT_SECRET ?? "").trim();
  if (!id || !secret) throw new PaypalError(0, null, "PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set.");
  if (cached && cached.exp > Date.now() + 30_000 && !o.fetch) return cached.token;
  const f = o.fetch ?? fetch;
  const res = await f(`${o.base ?? SANDBOX_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(20000),
  });
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) throw new PaypalError(res.status, body, `PayPal token request failed (HTTP ${res.status}).`);
  if (!o.fetch) cached = { token: body.access_token, exp: Date.now() + (Number(body.expires_in) || 300) * 1000 };
  return body.access_token;
}

async function call<T>(method: string, path: string, o: PaypalOptions, init: { body?: unknown; headers?: Record<string, string> } = {}): Promise<{ status: number; body: T }> {
  const token = await getAccessToken(o);
  const f = o.fetch ?? fetch;
  const res = await f(`${o.base ?? SANDBOX_BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new PaypalError(res.status, body, `PayPal ${method} ${path} returned HTTP ${res.status}${body?.name ? " " + body.name : ""}.`);
  return { status: res.status, body: body as T };
}

// ---------------------------------------------------------------- Invoicing v2
// Create draft: POST /v2/invoicing/invoices  (required: detail.currency_code, items[].name/quantity/unit_amount)
// https://developer.paypal.com/docs/api/invoicing/v2/#invoices_create
// Send:         POST /v2/invoicing/invoices/{invoice_id}/send  (body: subject, note, send_to_invoicer, send_to_recipient)
// https://developer.paypal.com/docs/api/invoicing/v2/#invoices_send
export function buildInvoice(e: LedgerEntry, invoiceNumber: string, opts: { merchantEmail?: string; businessName?: string; dueDate?: string } = {}) {
  const items: any[] = [{
    name: e.item.slice(0, 200),
    description: `Sold ${e.date}`.slice(0, 1000),
    quantity: "1",
    unit_amount: money(e.salePrice),
    unit_of_measure: "QUANTITY",
  }];
  const body: any = {
    detail: {
      invoice_number: invoiceNumber, // max 25 chars
      invoice_date: e.date, // date_no_time, YYYY-MM-DD
      currency_code: "USD",
      note: "Thanks for buying from us.",
      payment_term: opts.dueDate ? { term_type: "DUE_ON_DATE_SPECIFIED", due_date: opts.dueDate } : { term_type: "DUE_ON_RECEIPT" },
    },
    primary_recipients: [{ billing_info: { ...(e.buyerName ? { name: { full_name: e.buyerName } } : {}), email_address: e.buyerEmail } }],
    items,
    configuration: { allow_tip: false },
  };
  if (opts.businessName || opts.merchantEmail) {
    body.invoicer = { ...(opts.businessName ? { business_name: opts.businessName } : {}), ...(opts.merchantEmail ? { email_address: opts.merchantEmail } : {}) };
  }
  if (e.shippingCharged > 0) body.amount = { breakdown: { shipping: { amount: money(e.shippingCharged) } } };
  return body;
}

export function invoiceIdFromHref(href: string): string | undefined {
  return /\/invoices\/(INV2-[A-Z0-9-]+)/.exec(href)?.[1];
}

export async function createAndSendInvoice(e: LedgerEntry, invoiceNumber: string, o: PaypalOptions = {}) {
  const create = await call<any>("POST", "/v2/invoicing/invoices", o, {
    body: buildInvoice(e, invoiceNumber), headers: { prefer: "return=representation", "paypal-request-id": `cs-inv-${e.id}` },
  });
  const invoiceId: string | undefined = create.body?.id ?? (create.body?.href ? invoiceIdFromHref(create.body.href) : undefined);
  if (!invoiceId) throw new PaypalError(create.status, create.body, "Draft invoice created but no invoice id was returned.");
  const send = await call<any>("POST", `/v2/invoicing/invoices/${invoiceId}/send`, o, {
    body: { subject: `Invoice ${invoiceNumber} for ${e.item}`.slice(0, 200), send_to_recipient: true, send_to_invoicer: false },
  });
  return { invoiceId, invoiceNumber, sendStatus: send.status, sendBody: send.body };
}

// ---------------------------------------------------------------- Payments v2: refund
// POST /v2/payments/captures/{capture_id}/refund. Empty body = full refund; amount {currency_code,value} = partial.
// Body fields: amount, custom_id, invoice_id, note_to_payer (max 255), payment_instruction.
// Response 201 (200 on idempotent replay): { id, status, amount, seller_payable_breakdown, invoice_id, create_time, links }.
// https://developer.paypal.com/docs/api/payments/v2/#captures_refund
export function buildRefund(e: LedgerEntry, amount?: number, note?: string) {
  const body: any = {};
  if (amount !== undefined && amount > 0 && amount < e.salePrice + e.shippingCharged) body.amount = money(amount);
  if (e.paypal.invoiceNumber) body.invoice_id = e.paypal.invoiceNumber;
  body.custom_id = e.id;
  if (note) body.note_to_payer = note.slice(0, 255);
  return body;
}

export async function refundCapture(e: LedgerEntry, amount?: number, note?: string, o: PaypalOptions = {}) {
  const cap = e.paypal.transactionId;
  if (!cap) throw new PaypalError(0, null, "No PayPal transaction id on this entry yet. Run reconcile first.");
  const r = await call<any>("POST", `/v2/payments/captures/${encodeURIComponent(cap)}/refund`, o, {
    body: buildRefund(e, amount, note), headers: { "paypal-request-id": `cs-refund-${e.id}-${amount ?? "full"}`, prefer: "return=representation" },
  });
  return { refundId: r.body?.id as string, status: r.body?.status as string, amount: r.body?.amount as Money | undefined };
}

// ---------------------------------------------------------------- Payouts v1
// POST /v1/payments/payouts (required: sender_batch_header, items[] with receiver, amount{currency,value}).
// Payout items use "currency", not "currency_code". Response 201: batch_header.payout_batch_id, batch_status.
// A repeated sender_batch_id within 30 days is rejected, which makes retries safe.
// https://developer.paypal.com/docs/api/payments.payouts-batch/v1/#payouts_post
// GET /v1/payments/payouts/{payout_batch_id}  https://developer.paypal.com/docs/api/payments.payouts-batch/v1/#payouts_get
export function buildPayout(batchId: string, receiver: string, amount: number, note: string) {
  return {
    sender_batch_header: { sender_batch_id: batchId.slice(0, 256), recipient_type: "EMAIL", email_subject: "You have a payout", email_message: note.slice(0, 1000) },
    items: [{ recipient_type: "EMAIL", receiver, amount: { currency: "USD", value: amount.toFixed(2) }, note: note.slice(0, 4000), sender_item_id: batchId.slice(0, 63) }],
  };
}

export async function createPayout(batchId: string, receiver: string, amount: number, note: string, o: PaypalOptions = {}) {
  const r = await call<any>("POST", "/v1/payments/payouts", o, { body: buildPayout(batchId, receiver, amount, note), headers: { "paypal-request-id": batchId } });
  return { payoutBatchId: r.body?.batch_header?.payout_batch_id as string, batchStatus: r.body?.batch_header?.batch_status as string };
}

export async function getPayout(batchId: string, o: PaypalOptions = {}) {
  const r = await call<any>("GET", `/v1/payments/payouts/${encodeURIComponent(batchId)}`, o);
  return r.body;
}

// ---------------------------------------------------------------- Transaction Search v1
// GET /v1/reporting/transactions?start_date&end_date (both required, ISO 8601 with offset; keep each window to 31 days)
// &fields=transaction_info,payer_info,... &page_size (max 500) &page. Executed transactions can take up to 3 hours to appear.
// Response: { transaction_details[], account_number, page, total_items, total_pages, links }
// https://developer.paypal.com/docs/api/transaction-search/v1/#search_get
export interface TransactionDetail {
  transaction_info: {
    transaction_id: string;
    paypal_reference_id?: string;
    transaction_event_code?: string;
    transaction_initiation_date?: string;
    transaction_amount?: Money;
    fee_amount?: Money;
    transaction_status?: string;
    transaction_subject?: string;
    invoice_id?: string;
    custom_field?: string;
  };
  payer_info?: { email_address?: string; payer_name?: { given_name?: string; surname?: string; alternate_full_name?: string } };
}

export async function searchTransactions(start: string, end: string, o: PaypalOptions = {}): Promise<TransactionDetail[]> {
  const out: TransactionDetail[] = [];
  const DAY = 86400_000, WINDOW = 30 * DAY;
  for (let s = Date.parse(start); s < Date.parse(end); s += WINDOW) {
    const e = Math.min(s + WINDOW, Date.parse(end));
    for (let page = 1; page <= 20; page++) {
      const q = new URLSearchParams({ start_date: new Date(s).toISOString().replace(/\.\d+Z$/, "Z"), end_date: new Date(e).toISOString().replace(/\.\d+Z$/, "Z"), fields: "transaction_info,payer_info", page_size: "100", page: String(page) });
      const r = await call<any>("GET", `/v1/reporting/transactions?${q}`, o);
      out.push(...(r.body?.transaction_details ?? []));
      if (page >= (r.body?.total_pages ?? 1)) break;
    }
  }
  return out;
}

// POST /v2/invoicing/generate-next-invoice-number  -> { invoice_number } (the INV2- id is a different field)
// https://developer.paypal.com/docs/api/invoicing/v2/#invoicing_generate-next-invoice-number
export async function generateInvoiceNumber(o: PaypalOptions = {}): Promise<string> {
  const r = await call<any>("POST", "/v2/invoicing/generate-next-invoice-number", o, { body: {} });
  const n = r.body?.invoice_number;
  if (typeof n !== "string" || !n) throw new PaypalError(r.status, r.body, "PayPal returned no invoice_number.");
  return n;
}
