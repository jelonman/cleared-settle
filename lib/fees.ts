/**
 * Fee + profit math for resellers. Platform fee rates change often, so these are
 * sensible DEFAULTS the user can edit per calculation — the engine itself is the
 * source of truth and is fully unit-tested.
 */

export interface FeeModel {
  /** Percent of revenue (item price + shipping charged) taken as fees. */
  percent: number;
  /** Fixed per-order fee in dollars. */
  fixed: number;
}

export interface PlatformDefault extends FeeModel {
  id: string;
  name: string;
  note?: string;
}

// Approximate US rates as of 2026 — editable in the UI. Combined selling +
// payment-processing where the platform bundles them.
export const PLATFORMS: PlatformDefault[] = [
  { id: "ebay", name: "eBay", percent: 13.6, fixed: 0.4, note: "13.6% final value + $0.40 per order ($0.30 on orders of $10 or less; varies by category)" },
  { id: "poshmark", name: "Poshmark", percent: 20, fixed: 0, note: "20% for sales $15+, flat $2.95 under $15" },
  { id: "mercari", name: "Mercari", percent: 10, fixed: 0, note: "10% of item price + buyer-paid shipping, no processing fee (listings created or edited since 6 Jan 2025)" },
  { id: "depop", name: "Depop", percent: 3.3, fixed: 0.45, note: "US: no selling fee, ~3.3% + $0.45 payment processing" },
  { id: "etsy", name: "Etsy", percent: 9.5, fixed: 0.45, note: "6.5% transaction + ~3% + $0.25 payment + $0.20 listing" },
  { id: "vinted", name: "Vinted", percent: 0, fixed: 0, note: "No seller fees (buyer pays protection)" },
  { id: "other", name: "Other / custom", percent: 0, fixed: 0 },
];

export function platformById(id: string): PlatformDefault | undefined {
  return PLATFORMS.find((p) => p.id === id);
}

/** Resolve the effective fee for a platform at a given revenue (handles tiers). */
export function resolveFee(platformId: string, revenue: number): FeeModel {
  if (platformId === "poshmark") {
    return revenue < 15 ? { percent: 0, fixed: 2.95 } : { percent: 20, fixed: 0 };
  }
  if (platformId === "ebay") {
    // eBay's per-order fee is tiered: $0.30 on orders of $10 or less, $0.40 above.
    return { percent: 13.6, fixed: revenue <= 10 ? 0.3 : 0.4 };
  }
  const p = platformById(platformId);
  return p ? { percent: p.percent, fixed: p.fixed } : { percent: 0, fixed: 0 };
}

export interface BreakdownInput {
  salePrice: number;
  shippingCharged?: number; // shipping the buyer paid you
  cost?: number; // what you paid for the item
  shipCost?: number; // what you pay to ship it
  otherCost?: number; // supplies, etc.
  fee: FeeModel;
}

export interface Breakdown {
  revenue: number;
  fees: number;
  costBasis: number;
  net: number;
  marginPct: number; // net / revenue
  roiPct: number | null; // net / costBasis
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeBreakdown(i: BreakdownInput): Breakdown {
  const salePrice = Math.max(0, i.salePrice || 0);
  const shippingCharged = Math.max(0, i.shippingCharged || 0);
  const cost = Math.max(0, i.cost || 0);
  const shipCost = Math.max(0, i.shipCost || 0);
  const otherCost = Math.max(0, i.otherCost || 0);

  const revenue = r2(salePrice + shippingCharged);
  const fees = r2((revenue * (i.fee.percent || 0)) / 100 + (i.fee.fixed || 0));
  const costBasis = r2(cost + shipCost + otherCost);
  const net = r2(revenue - fees - costBasis);
  const marginPct = revenue > 0 ? r2((net / revenue) * 100) : 0;
  const roiPct = costBasis > 0 ? r2((net / costBasis) * 100) : null;

  return { revenue, fees, costBasis, net, marginPct, roiPct };
}

/** Lowest sale price to clear a target net profit on a platform (handy for "what to list at"). */
export function priceForTargetNet(
  platformId: string,
  costBasis: number,
  targetNet: number,
): number {
  // net = price - (price*pct/100 + fixed) - costBasis  (assuming shipping baked in)
  // price = (targetNet + costBasis + fixed) / (1 - pct/100)
  const fee = resolveFee(platformId, costBasis + targetNet);
  const denom = 1 - fee.percent / 100;
  if (denom <= 0) return Infinity;
  return Math.round(((targetNet + costBasis + fee.fixed) / denom) * 100) / 100;
}
