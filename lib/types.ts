export type Money = { currency_code: string; value: string };

export interface PaypalRefs {
  invoiceNumber?: string; // our invoice_number, also echoed by Transaction Search as transaction_info.invoice_id
  invoiceId?: string; // PayPal invoice id (INV2-...)
  transactionId?: string; // PayPal transaction id found by reconcile; used as capture_id for refunds
  refundId?: string;
  payoutBatchId?: string;
}

export interface LedgerEntry {
  id: string;
  date: string; // YYYY-MM-DD
  item: string;
  platform: string; // id from fees.ts PLATFORMS, or "direct"
  salePrice: number;
  shippingCharged: number;
  cost: number;
  shipCost: number;
  buyerName?: string;
  buyerEmail?: string;
  paypal: PaypalRefs;
  status: "sold" | "invoiced" | "paid" | "refunded";
  actualFee?: number; // set by reconcile from transaction_info.fee_amount
}

export type ActionKind = "invoice" | "refund" | "payout";

export interface ProposedAction {
  id: string;
  kind: ActionKind;
  entryId?: string;
  reason: string;
  // invoice
  buyerEmail?: string;
  // refund
  amount?: number;
  // payout
  receiver?: string;
  note?: string;
}
