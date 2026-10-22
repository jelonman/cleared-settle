#!/usr/bin/env bash
# Live check against the PayPal SANDBOX. Needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.
# Optional: SMOKE_BUYER_EMAIL (a sandbox personal account), SMOKE_PAYOUT_EMAIL, SMOKE_CAPTURE_ID (to test a refund).
# Usage: PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... scripts/smoke.sh [https://your-deployment]
set -uo pipefail
B=https://api-m.sandbox.paypal.com
: "${PAYPAL_CLIENT_ID:?set PAYPAL_CLIENT_ID}"; : "${PAYPAL_CLIENT_SECRET:?set PAYPAL_CLIENT_SECRET}"
command -v jq >/dev/null || { echo "jq is required"; exit 2; }
fail=0; ok(){ echo "PASS  $*"; }; bad(){ echo "FAIL  $*"; fail=1; }

# 1. OAuth: https://developer.paypal.com/api/rest/authentication/
T=$(curl -s -u "$PAYPAL_CLIENT_ID:$PAYPAL_CLIENT_SECRET" -d grant_type=client_credentials $B/v1/oauth2/token | jq -r .access_token)
[ -n "$T" ] && [ "$T" != null ] && ok "token" || { bad "token (check the two env vars are SANDBOX credentials)"; exit 1; }
H=(-H "Authorization: Bearer $T" -H "Content-Type: application/json")

# 2. Invoicing v2: next number, create draft (Prefer: return=representation), send
N=$(curl -s -X POST "${H[@]}" -d '{}' $B/v2/invoicing/generate-next-invoice-number | jq -r .invoice_number)
[ -n "$N" ] && [ "$N" != null ] && ok "generate-next-invoice-number -> $N" || bad "generate-next-invoice-number"
BUYER=${SMOKE_BUYER_EMAIL:-buyer@example.com}
INV=$(curl -s -X POST "${H[@]}" -H "Prefer: return=representation" $B/v2/invoicing/invoices -d "{\"detail\":{\"invoice_number\":\"$N\",\"currency_code\":\"USD\",\"payment_term\":{\"term_type\":\"DUE_ON_RECEIPT\"}},\"primary_recipients\":[{\"billing_info\":{\"email_address\":\"$BUYER\"}}],\"items\":[{\"name\":\"Smoke test item\",\"quantity\":\"1\",\"unit_amount\":{\"currency_code\":\"USD\",\"value\":\"5.00\"}}]}" | jq -r '.id // (.href|capture("(?<i>INV2-[A-Z0-9-]+)").i)')
[[ "$INV" == INV2-* ]] && ok "create invoice -> $INV" || bad "create invoice"
if [[ "$INV" == INV2-* ]]; then
  C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${H[@]}" $B/v2/invoicing/invoices/$INV/send -d '{"send_to_recipient":true,"send_to_invoicer":false}')
  [[ "$C" == 200 || "$C" == 202 ]] && ok "send invoice HTTP $C" || bad "send invoice HTTP $C"
fi

# 3. Payouts v1 (needs Payouts enabled on the sandbox business account)
if [ -n "${SMOKE_PAYOUT_EMAIL:-}" ]; then
  SB="smoke-$(date +%s)"
  P=$(curl -s -X POST "${H[@]}" $B/v1/payments/payouts -d "{\"sender_batch_header\":{\"sender_batch_id\":\"$SB\",\"recipient_type\":\"EMAIL\",\"email_subject\":\"Smoke\"},\"items\":[{\"recipient_type\":\"EMAIL\",\"receiver\":\"$SMOKE_PAYOUT_EMAIL\",\"amount\":{\"currency\":\"USD\",\"value\":\"1.00\"},\"sender_item_id\":\"$SB\"}]}" | jq -r .batch_header.payout_batch_id)
  [ -n "$P" ] && [ "$P" != null ] && ok "payout batch $P" || bad "payout"
else echo "SKIP  payout (set SMOKE_PAYOUT_EMAIL)"; fi

# 4. Transaction Search v1 (new transactions can take up to 3 hours to appear)
S=$(date -u -d '-3 days' +%Y-%m-%dT%H:%M:%SZ); E=$(date -u +%Y-%m-%dT%H:%M:%SZ)
R=$(curl -s "${H[@]}" "$B/v1/reporting/transactions?start_date=$S&end_date=$E&fields=transaction_info,payer_info&page_size=20")
echo "$R" | jq -e '.transaction_details' >/dev/null && ok "transaction search -> $(echo "$R" | jq '.transaction_details|length') rows" || bad "transaction search: $(echo "$R" | jq -c '.name,.message')"
echo "$R" | jq -r '.transaction_details[0:3][]?.transaction_info | "      sample row: id=\(.transaction_id) amount=\(.transaction_amount.value) fee=\(.fee_amount.value // "none") invoice_id=\(.invoice_id // "none")"'

# 5. Refund (Payments v2). ASSUMPTION CHECKED HERE: a Transaction Search transaction_id works as capture_id.
if [ -n "${SMOKE_CAPTURE_ID:-}" ]; then
  C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${H[@]}" -H "PayPal-Request-Id: smoke-refund-$SMOKE_CAPTURE_ID" $B/v2/payments/captures/$SMOKE_CAPTURE_ID/refund -d '{"amount":{"currency_code":"USD","value":"1.00"},"note_to_payer":"smoke test"}')
  [[ "$C" == 200 || "$C" == 201 ]] && ok "refund HTTP $C" || bad "refund HTTP $C"
else echo "SKIP  refund (set SMOKE_CAPTURE_ID to a sandbox payment's transaction_id)"; fi

# 6. The deployed app, if a URL was given
if [ -n "${1:-}" ]; then curl -s "$1/api/status" | jq -e '.paypal==true' >/dev/null && ok "deployment sees the keys" || bad "deployment does not see the keys"; fi
exit $fail
