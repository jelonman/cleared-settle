# Cleared Settle

An AI settlement agent for resellers, built on the PayPal REST APIs (sandbox).

Resellers sell on marketplaces and also directly (Instagram, local, repeat buyers) where the buyer pays by PayPal. The money side of that is scattered: invoices by hand, refunds in one place, a family consignor to pay, and no check that what PayPal paid matches the books. Cleared Settle fixes that loop.

1. **Tell the agent.** Paste messy notes. A language model (Agnes 2.5, free tier) turns them into ledger entries and *proposes* invoices, refunds and payouts. It never holds the PayPal keys and never calls PayPal. Every proposal is validated in code (`lib/agent.ts`): invented ledger references, malformed payouts and invoices for marketplace sales are dropped.
2. **Approve on the Settle desk.** One click per action.
3. **Reconcile.** Transaction Search is matched to the ledger by invoice number, then custom field, then a *unique* payer-and-amount match (`lib/reconcile.ts`, no model involved). Estimated fees are replaced by the real `fee_amount`, refund rows are tied to their payments, and unknown money is flagged. The model then writes a short plain-language note.

## PayPal endpoints used (all sandbox, `https://api-m.sandbox.paypal.com`)

| Step | Endpoint | Docs |
| --- | --- | --- |
| Auth | `POST /v1/oauth2/token` | https://developer.paypal.com/api/rest/authentication/ |
| Invoice number | `POST /v2/invoicing/generate-next-invoice-number` | https://developer.paypal.com/docs/api/invoicing/v2/#invoicing_generate-next-invoice-number |
| Create draft invoice | `POST /v2/invoicing/invoices` | https://developer.paypal.com/docs/api/invoicing/v2/#invoices_create |
| Send invoice | `POST /v2/invoicing/invoices/{invoice_id}/send` | https://developer.paypal.com/docs/api/invoicing/v2/#invoices_send |
| Refund | `POST /v2/payments/captures/{capture_id}/refund` | https://developer.paypal.com/docs/api/payments/v2/#captures_refund |
| Payout | `POST /v1/payments/payouts`, `GET /v1/payments/payouts/{id}` | https://developer.paypal.com/docs/api/payments.payouts-batch/v1/ |
| Reconcile | `GET /v1/reporting/transactions` | https://developer.paypal.com/docs/api/transaction-search/v1/ |

Request builders are tested against PayPal's own OpenAPI files (`spec/`, from github.com/paypal/paypal-rest-api-specifications): an undocumented property, a missing required one or a wrong type fails the test. Response fixtures are checked the same way.

## Run it

```sh
npm install
cp .env.example .env.local   # PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET (sandbox app), LLM_API_KEY
npm run dev                  # http://localhost:3000
npm test                     # 24 tests, fixtures shaped like the documented responses
PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... scripts/smoke.sh [https://your-deployment]
```

Create the two values at developer.paypal.com under Apps & Credentials, Sandbox. Language steps accept any OpenAI-compatible endpoint (`LLM_BASE_URL`, `LLM_MODEL`).

## Honest about its state

Without the PayPal keys the app still runs the agent live, then shows the exact request each approved action *would* send, marked as a preview. Reconcile offers a clearly labelled sample tape (generated locally, not PayPal data). Nothing is presented as a live result unless PayPal returned it. A per-IP limit protects a public demo.

## Layout

`lib/paypal.ts` client and builders, `lib/agent.ts` model steps and validation, `lib/reconcile.ts` matching, `lib/service.ts` live-or-preview switch, `app/api/*` routes, `tests/` and `spec/`.

## Origin

Grew out of [Cleared](https://cleared.vercel.app), the reseller fee calculator and P&L ledger. The fee engine (`lib/fees.ts`) comes from there. Everything PayPal- and agent-related was built for this hackathon.

MIT licence, Piotr Sarna.
