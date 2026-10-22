// A locally generated "sample tape": rows shaped like Transaction Search output, built from the
// user's own direct sales plus two rows the ledger does not know. Used only for the labelled
// sample run when no PayPal keys exist. It is not PayPal data and the UI says so.
import type { LedgerEntry } from "./types";
import type { TransactionDetail } from "./paypal";

export function sampleTape(entries: LedgerEntry[]): TransactionDetail[] {
  const rows: TransactionDetail[] = [];
  let n = 0;
  for (const e of entries.filter((x) => x.platform === "direct")) {
    const gross = Math.round((e.salePrice + e.shippingCharged) * 100) / 100;
    const fee = Math.round((gross * 0.0299 + 0.49) * 100) / 100; // sample rate, deliberately not the ledger estimate
    rows.push({
      transaction_info: {
        transaction_id: `SAMPLE${String(++n).padStart(12, "0")}`, transaction_event_code: "T0006", transaction_status: "S",
        transaction_initiation_date: `${e.date}T12:00:00+0000`, transaction_amount: { currency_code: "USD", value: gross.toFixed(2) },
        fee_amount: { currency_code: "USD", value: (-fee).toFixed(2) }, invoice_id: e.paypal.invoiceNumber,
      },
      payer_info: { email_address: e.buyerEmail },
    });
    if (e.status === "refunded") rows.push({ transaction_info: { transaction_id: `SAMPLE${String(++n).padStart(12, "0")}`, paypal_reference_id: rows[rows.length - 1].transaction_info.transaction_id, transaction_status: "S", transaction_amount: { currency_code: "USD", value: (-gross).toFixed(2) } } });
  }
  rows.push({ transaction_info: { transaction_id: "SAMPLE0000000UNK1", transaction_status: "S", transaction_subject: "Unlabelled payment", transaction_amount: { currency_code: "USD", value: "18.00" }, fee_amount: { currency_code: "USD", value: "-1.12" } }, payer_info: { email_address: "someone@example.com" } });
  return rows;
}
