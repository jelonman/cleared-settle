// The agent: turns free text into ledger entries and proposed PayPal actions. The model only
// proposes. It never holds the keys, never calls PayPal, and every id it returns is checked
// against the ledger before an action is accepted.
import { chatJson, type LlmOptions } from "./llm";
import { PLATFORMS } from "./fees";
import type { LedgerEntry, ProposedAction } from "./types";

const PLATFORM_IDS = [...PLATFORMS.map((p) => p.id), "direct"];

export const SYSTEM = `You are the settlement agent inside a reseller's ledger. Read the seller's notes and return JSON:
{"entries":[{"item":string,"platform":one of ${PLATFORM_IDS.join("|")},"date":"YYYY-MM-DD","salePrice":number,"shippingCharged":number,"cost":number,"shipCost":number,"buyerName":string?,"buyerEmail":string?}],
 "actions":[{"kind":"invoice"|"refund"|"payout","entryRef":string,"reason":string,"amount":number?,"receiver":string?,"note":string?}]}
Rules:
- platform "direct" means the buyer pays the seller by PayPal outside a marketplace (message, local, social). Only "direct" sales get an "invoice" action, and only when a buyer email is given.
- "refund": the seller agreed to refund a buyer. entryRef is the item name or an existing entry id from the list. amount only for a partial refund.
- "payout": the seller owes someone money (a consignor share or supplier). receiver must be an email given in the notes. amount is a number.
- Use today's date when none is said. Money is USD. Use 0 for unknown numbers. Never invent emails or amounts that are not in the notes.
- An entryRef for a new entry is that entry's item text exactly.`;

export interface AgentReply { entries: Omit<LedgerEntry, "id" | "paypal" | "status">[]; actions: { kind: string; entryRef: string; reason: string; amount?: number; receiver?: string; note?: string }[] }

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const isEmail = (s: unknown): s is string => typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export function newId(prefix = "e") { return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`; }

/** Validate the model reply. Drops anything malformed; never throws on bad model output. */
export function validateReply(raw: any, existing: LedgerEntry[], today: string): { entries: LedgerEntry[]; actions: ProposedAction[]; dropped: string[] } {
  const dropped: string[] = [];
  const entries: LedgerEntry[] = [];
  for (const x of Array.isArray(raw?.entries) ? raw.entries : []) {
    if (typeof x?.item !== "string" || !x.item.trim() || !isNum(x.salePrice) || x.salePrice <= 0) { dropped.push(`entry skipped: ${JSON.stringify(x)?.slice(0, 80)}`); continue; }
    const platform = PLATFORM_IDS.includes(x.platform) ? x.platform : "other";
    const buyerEmail = isEmail(x.buyerEmail) ? x.buyerEmail : undefined;
    entries.push({
      id: newId(), item: x.item.trim().slice(0, 200), platform, date: /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : today,
      salePrice: x.salePrice, shippingCharged: isNum(x.shippingCharged) ? x.shippingCharged : 0, cost: isNum(x.cost) ? x.cost : 0, shipCost: isNum(x.shipCost) ? x.shipCost : 0,
      buyerName: typeof x.buyerName === "string" ? x.buyerName.slice(0, 100) : undefined, buyerEmail, paypal: {}, status: "sold",
    });
  }
  const all = [...existing, ...entries];
  const find = (ref: string) => all.find((e) => e.id === ref) ?? all.find((e) => e.item.toLowerCase() === String(ref).toLowerCase()) ?? all.find((e) => String(ref).length > 3 && e.item.toLowerCase().includes(String(ref).toLowerCase()));
  const actions: ProposedAction[] = [];
  for (const a of Array.isArray(raw?.actions) ? raw.actions : []) {
    const reason = typeof a?.reason === "string" ? a.reason.slice(0, 300) : "";
    if (a?.kind === "payout") {
      if (!isEmail(a.receiver) || !isNum(a.amount) || a.amount <= 0) { dropped.push("payout dropped: needs a receiver email and an amount"); continue; }
      actions.push({ id: newId("a"), kind: "payout", receiver: a.receiver, amount: a.amount, reason, note: typeof a.note === "string" ? a.note : reason });
      continue;
    }
    const e = find(a?.entryRef);
    if (!e) { dropped.push(`${a?.kind} dropped: no ledger entry matches "${a?.entryRef}"`); continue; }
    if (a.kind === "invoice") {
      if (e.platform !== "direct" || !e.buyerEmail) { dropped.push(`invoice dropped for "${e.item}": only direct sales with a buyer email can be invoiced`); continue; }
      actions.push({ id: newId("a"), kind: "invoice", entryId: e.id, buyerEmail: e.buyerEmail, reason });
    } else if (a.kind === "refund") {
      actions.push({ id: newId("a"), kind: "refund", entryId: e.id, amount: isNum(a.amount) && a.amount > 0 ? a.amount : undefined, reason });
    } else dropped.push(`unknown action kind ${String(a?.kind)}`);
  }
  return { entries, actions, dropped };
}

export async function runAgent(text: string, existing: LedgerEntry[], today: string, o: LlmOptions = {}) {
  const list = existing.slice(-40).map((e) => `${e.id} | ${e.item} | ${e.platform} | ${e.salePrice}`).join("\n") || "(empty)";
  const raw = await chatJson<AgentReply>(SYSTEM, `Today: ${today}\nExisting entries (id | item | platform | price):\n${list}\n\nSeller notes:\n${text.slice(0, 4000)}`, o);
  return validateReply(raw, existing, today);
}

export const EXPLAIN_SYSTEM = `You write a short, plain reconciliation note for a reseller. Input is JSON of what matched between their ledger and PayPal, and what did not. Reply JSON {"summary":string,"todo":string[]}. summary: 2 sentences max. todo: at most 4 concrete next steps, each one line. Only use numbers present in the input.`;
