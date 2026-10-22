// Fixtures shaped like the documented PayPal responses (values invented for tests).
import type { LedgerEntry } from "../lib/types";
import type { TransactionDetail } from "../lib/paypal";

// https://developer.paypal.com/api/rest/authentication/
export const tokenResponse = { scope: "https://uri.paypal.com/services/invoicing", access_token: "A21AAFEpH4PsADK7qSS7pSRsgzfENtu-Q1ysgEDVDESseMHBYXVJYE8ovjj68elIDy8nF26AwPhfXTIeWAZHSLIsQkSYz9ifg", token_type: "Bearer", app_id: "APP-80W284485P519543T", expires_in: 32400, nonce: "2020-04-03T15:35:36ZaYZlGvEkV4yVSz8g6bAKFoGSEzuy3CQcz3ljhibkOHg" };

// POST /v2/invoicing/invoices with Prefer: return=representation
export const invoiceCreated = { id: "INV2-Z56S-5LLA-Q52L-CPZ5", status: "DRAFT", detail: { invoice_number: "CS-20261020-ab12", currency_code: "USD" }, links: [{ href: "https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-Z56S-5LLA-Q52L-CPZ5", rel: "self", method: "GET" }] };
// POST /v2/invoicing/invoices/{id}/send -> 200 with a link
export const invoiceSent = { rel: "self", href: "https://www.sandbox.paypal.com/invoice/p/#Z56S5LLAQ52LCPZ5", method: "GET" };
export const nextInvoiceNumber = { invoice_number: "0001" };

// POST /v2/payments/captures/{id}/refund 201
export const refundCreated = { id: "1JU08902781691411", amount: { value: "10.99", currency_code: "USD" }, status: "COMPLETED", seller_payable_breakdown: { gross_amount: { value: "10.99", currency_code: "USD" }, paypal_fee: { value: "0", currency_code: "USD" }, net_amount: { value: "10.99", currency_code: "USD" }, total_refunded_amount: { value: "10.99", currency_code: "USD" } }, invoice_id: "INVOICE-123", create_time: "2018-09-11T23:24:19Z", update_time: "2018-09-11T23:24:19Z", links: [{ rel: "self", method: "GET", href: "https://api-m.sandbox.paypal.com/v2/payments/refunds/1JU08902781691411" }] };

// POST /v1/payments/payouts 201
export const payoutCreated = { batch_header: { payout_batch_id: "5UXD6M9QYW2QL", batch_status: "PENDING", sender_batch_header: { sender_batch_id: "cs-a_1", email_subject: "You have a payout" } }, links: [{ href: "https://api-m.sandbox.paypal.com/v1/payments/payouts/5UXD6M9QYW2QL", rel: "self", method: "GET" }] };

// GET /v1/reporting/transactions
export const tx = (id: string, amount: string, fee: string | undefined, extra: Partial<TransactionDetail["transaction_info"]> = {}, email?: string): TransactionDetail => ({
  transaction_info: { transaction_id: id, transaction_event_code: "T0006", transaction_status: "S", transaction_initiation_date: "2026-10-20T09:00:00+0000", transaction_amount: { currency_code: "USD", value: amount }, ...(fee ? { fee_amount: { currency_code: "USD", value: fee } } : {}), ...extra },
  payer_info: email ? { email_address: email } : undefined,
});

export const entry = (o: Partial<LedgerEntry> = {}): LedgerEntry => ({ id: "e_1", date: "2026-10-20", item: "Levi's 501 jeans W32", platform: "direct", salePrice: 42, shippingCharged: 6, cost: 9, shipCost: 5, buyerName: "Sam Rivera", buyerEmail: "sam@example.com", paypal: {}, status: "sold", ...o });
