"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PLATFORMS, resolveFee, computeBreakdown } from "@/lib/fees";
import type { LedgerEntry, ProposedAction } from "@/lib/types";
import type { Reconciliation } from "@/lib/reconcile";

type Status = { paypal: boolean; llm: boolean };
type Out = { mode: "preview" | "live" | "error"; text: string; json?: unknown };
type Rec = { source: "paypal-sandbox" | "sample" | "none"; count?: number; result?: Reconciliation; note?: string; request?: { method: string; url: string } };

const STORE = "cleared-settle-v1";
const EXAMPLE = `Sold the vintage Seiko 5 watch to Ana Lopez (ana@example.com) off Instagram for 120 plus 8 shipping, paid 40 for it, 6 to post. She pays by PayPal.
Poshmark: Nike tech hoodie sold 34, cost 11, shipping 7.
Refund Sam Rivera 10 on the Levi's jeans, small stain I missed.
I owe my mum (mum@example.com) 30 for her share of the camera lot.`;
const SAMPLE: Omit<LedgerEntry, "id">[] = [
  { date: "2026-10-18", item: "Levi's 501 jeans W32", platform: "direct", salePrice: 42, shippingCharged: 6, cost: 9, shipCost: 5, buyerName: "Sam Rivera", buyerEmail: "sam@example.com", paypal: {}, status: "sold" },
  { date: "2026-10-19", item: "Nike tech hoodie M", platform: "poshmark", salePrice: 34, shippingCharged: 0, cost: 11, shipCost: 7, paypal: {}, status: "sold" },
  { date: "2026-10-20", item: "Seiko 5 automatic watch", platform: "direct", salePrice: 120, shippingCharged: 8, cost: 40, shipCost: 6, buyerName: "Ana Lopez", buyerEmail: "ana@example.com", paypal: {}, status: "sold" },
  { date: "2026-10-21", item: "Canon AE-1 camera body", platform: "ebay", salePrice: 96, shippingCharged: 12, cost: 38, shipCost: 12, paypal: {}, status: "sold" },
];

const usd = (n: number) => (n < 0 ? "-" : "") + "$" + Math.abs(n).toFixed(2);
const uid = () => "e_" + Math.random().toString(36).slice(2, 8);

function estFees(e: LedgerEntry) {
  if (e.actualFee !== undefined) return { v: e.actualFee, actual: true };
  const rev = e.salePrice + e.shippingCharged;
  const fee = e.platform === "direct" ? { percent: 3.49, fixed: 0.49 } : resolveFee(e.platform, rev);
  return { v: computeBreakdown({ salePrice: e.salePrice, shippingCharged: e.shippingCharged, fee }).fees, actual: false };
}
const netOf = (e: LedgerEntry) => Math.round((e.salePrice + e.shippingCharged - estFees(e).v - e.cost - e.shipCost) * 100) / 100;
const platName = (id: string) => (id === "direct" ? "Direct (PayPal)" : PLATFORMS.find((p) => p.id === id)?.name ?? id);

const Icon = {
  invoice: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></svg>,
  refund: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>,
  payout: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h14" /><path d="m13 6 6 6-6 6" /></svg>,
};

export default function Page() {
  const [status, setStatus] = useState<Status | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [actions, setActions] = useState<ProposedAction[]>([]);
  const [outs, setOuts] = useState<Record<string, Out>>({});
  const [busy, setBusy] = useState<string>("");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ t: string; bad?: boolean }>({ t: "" });
  const [rec, setRec] = useState<Rec | null>(null);
  const [note, setNote] = useState<{ summary: string | null; todo: string[] } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => setStatus({ paypal: false, llm: false }));
    try { const s = JSON.parse(localStorage.getItem(STORE) || "null"); if (s) { setEntries(s.entries ?? []); setActions(s.actions ?? []); } } catch { /* storage unavailable */ }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) try { localStorage.setItem(STORE, JSON.stringify({ entries, actions })); } catch { /* storage unavailable */ } }, [entries, actions, ready]);

  const totals = useMemo(() => {
    const gross = entries.reduce((s, e) => s + e.salePrice + e.shippingCharged, 0);
    const fees = entries.reduce((s, e) => s + estFees(e).v, 0);
    return { gross, fees, net: entries.reduce((s, e) => s + netOf(e), 0) };
  }, [entries]);

  const runAgent = useCallback(async () => {
    setBusy("agent"); setMsg({ t: "" });
    try {
      const r = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, entries }) });
      const j = await r.json();
      if (!r.ok) { setMsg({ t: j.error ?? "The agent failed.", bad: true }); return; }
      setEntries((p) => [...p, ...j.entries]); setActions((p) => [...p, ...j.actions]);
      const d = j.dropped?.length ? ` ${j.dropped.length} item${j.dropped.length > 1 ? "s were" : " was"} dropped as unsafe or unclear: ${j.dropped.join("; ")}.` : "";
      setMsg({ t: `Added ${j.entries.length} sale${j.entries.length === 1 ? "" : "s"} and proposed ${j.actions.length} action${j.actions.length === 1 ? "" : "s"}.${d}` });
      setText("");
    } catch { setMsg({ t: "Could not reach the agent.", bad: true }); } finally { setBusy(""); }
  }, [text, entries]);

  const runAction = useCallback(async (a: ProposedAction) => {
    setBusy(a.id);
    const entry = entries.find((e) => e.id === a.entryId);
    try {
      const r = await fetch("/api/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: a, entry }) });
      const j = await r.json();
      if (!r.ok) { setOuts((o) => ({ ...o, [a.id]: { mode: "error", text: j.error ?? "Failed", json: j.paypal } })); return; }
      if (j.mode === "preview") { setOuts((o) => ({ ...o, [a.id]: { mode: "preview", text: j.note, json: { [`${j.method} ${j.path}`]: j.body } } })); return; }
      setOuts((o) => ({ ...o, [a.id]: { mode: "live", text: j.detail } }));
      if (entry) setEntries((p) => p.map((e) => e.id !== entry.id ? e : { ...e, paypal: { ...e.paypal, ...j.refs }, status: a.kind === "invoice" ? "invoiced" : a.kind === "refund" ? "refunded" : e.status }));
    } catch { setOuts((o) => ({ ...o, [a.id]: { mode: "error", text: "Network error." } })); } finally { setBusy(""); }
  }, [entries]);

  const runRecon = useCallback(async (sample: boolean) => {
    setBusy("rec"); setNote(null);
    try {
      const r = await fetch("/api/reconcile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entries, sample }) });
      const j = await r.json();
      if (!r.ok) { setRec({ source: "none", note: j.error ?? "Reconcile failed." }); return; }
      setRec(j);
      if (j.result) {
        const res: Reconciliation = j.result;
        setEntries((p) => p.map((e) => {
          const m = res.matched.find((x) => x.entryId === e.id); if (!m) return e;
          const refunded = res.refunded.some((x) => x.entryId === e.id);
          return { ...e, actualFee: m.fee, status: refunded ? "refunded" : "paid", paypal: { ...e.paypal, transactionId: m.transactionId } };
        }));
        fetch("/api/explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ result: res }) }).then((x) => x.json()).then(setNote).catch(() => {});
      }
    } catch { setRec({ source: "none", note: "Could not reach the server." }); } finally { setBusy(""); }
  }, [entries]);

  const dismiss = (id: string) => setActions((p) => p.filter((a) => a.id !== id));
  const addSample = () => { setEntries((p) => [...p, ...SAMPLE.map((s) => ({ ...s, id: uid() }))]); setMsg({ t: "Added four example sales. Ask the agent about them, or paste your own notes." }); };
  const reset = () => { setEntries([]); setActions([]); setOuts({}); setRec(null); setNote(null); setMsg({ t: "" }); };

  const live = status?.paypal;
  return (
    <>
      <header className="hd-bar">
        <div className="hd-logo">
          <svg className="hd-mark" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="26" height="22" rx="6" /><path d="m10 16.5 4.2 4.2L22 11.5" /></svg>
          Cleared Settle
        </div>
        <div className="hd-status" aria-label="Connection status">
          <span className="st-pill" data-on={String(Boolean(live))}><i className="st-dot" />PayPal sandbox: {status ? (live ? "connected" : "keys not set") : "checking"}</span>
          <span className="st-pill" data-on={String(Boolean(status?.llm))}><i className="st-dot" />Agent: {status ? (status.llm ? "ready" : "key not set") : "checking"}</span>
        </div>
      </header>

      <section className="hr-wrap">
        <h1 className="hr-title">Every sale, <span>settled.</span></h1>
        <div>
          <p className="hr-lede">Tell the agent what you sold. It builds the ledger, drafts the PayPal invoices, refunds and payouts, and checks all of it against what PayPal really paid you.</p>
          <p className="hr-honest" role="note"><b>Sandbox only.</b> {live ? "PayPal sandbox keys are set on this server, so approved actions run against the sandbox." : "Live PayPal calls need the sandbox keys, which are not set on this deployment. Approving an action shows the exact request it would send. Nothing is sent and no result is faked."}</p>
        </div>
      </section>

      <main className="wk-grid">
        <div className="stack">
          <section className="panel" aria-labelledby="cp-h">
            <div className="panel-h"><h2 id="cp-h">Tell the agent</h2><small>Plain notes are fine</small></div>
            <div className="cp-box">
              <label htmlFor="cp-text" className="sr-only">Sales notes</label>
              <textarea id="cp-text" className="cp-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Sold the denim jacket to Mia (mia@example.com) for 55, paid 14, she pays by PayPal..." />
              <div className="cp-row">
                <div>
                  <button className="bt bt-quiet" type="button" onClick={() => setText(EXAMPLE)}>Fill example notes</button>
                  <button className="bt bt-quiet" type="button" onClick={addSample}>Add example sales</button>
                </div>
                <button className="bt bt-main" type="button" disabled={!text.trim() || busy === "agent"} onClick={runAgent}>{busy === "agent" ? <><i className="bt-spin" />Reading</> : "Read my notes"}</button>
              </div>
            </div>
            <p className="cp-msg" data-bad={String(Boolean(msg.bad))} aria-live="polite">{msg.t || (status && !status.llm ? "The agent key is not set on this server. You can still add example sales." : "")}</p>
          </section>

          <section className="panel" aria-labelledby="lg-h">
            <div className="panel-h"><h2 id="lg-h">Ledger</h2>{entries.length > 0 && <button className="bt bt-quiet" type="button" onClick={reset}>Clear all</button>}</div>
            <div className="lg-tools">
              <div className="lg-sum"><div><span>Gross</span><b>{usd(totals.gross)}</b></div><div><span>Fees</span><b>{usd(totals.fees)}</b></div><div><span>Net after costs</span><b>{usd(totals.net)}</b></div></div>
            </div>
            <div className="lg-scroll">
              <table className="lg-table">
                <thead><tr><th>Date</th><th>Item</th><th className="r">Sale</th><th className="r">Fees</th><th className="r">Net</th><th>Status</th></tr></thead>
                <tbody>
                  {entries.map((e) => { const f = estFees(e); const n = netOf(e); return (
                    <tr className="lg-row" key={e.id}>
                      <td className="num">{e.date.slice(5)}</td>
                      <td className="lg-item"><b>{e.item}</b><small>{platName(e.platform)}{e.buyerName ? ` · ${e.buyerName}` : ""}</small></td>
                      <td className="r num">{usd(e.salePrice + e.shippingCharged)}</td>
                      <td className={"r num" + (f.actual ? "" : " lg-est")} title={f.actual ? "Actual fee from PayPal" : "Estimated from default rates"}>{f.actual ? "" : "~"}{usd(f.v)}</td>
                      <td className={"r num" + (n < 0 ? " lg-neg" : "")}>{usd(n)}</td>
                      <td><span className="lg-st" data-s={e.status}>{e.status === "paid" && <svg className="lg-stamp" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>}{e.status === "paid" ? "cleared" : e.status}</span></td>
                    </tr>); })}
                </tbody>
              </table>
              {entries.length === 0 && <p className="lg-empty">No sales yet. Paste notes above, or add the four example sales.</p>}
            </div>
          </section>
        </div>

        <div className="stack">
          <section className="panel" aria-labelledby="ac-h">
            <div className="panel-h"><h2 id="ac-h">Settle desk</h2><small>{actions.length ? `${actions.length} waiting for you` : "Nothing waiting"}</small></div>
            {actions.length === 0 && <p className="lg-empty">The agent proposes invoices, refunds and payouts here. You approve each one.</p>}
            <ul className="ac-list">
              {actions.map((a) => { const e = entries.find((x) => x.id === a.entryId); const o = outs[a.id]; return (
                <li className="ac-item" key={a.id}>
                  <div className="ac-top">
                    <span className="ac-ico">{Icon[a.kind]}</span>
                    <div>
                      <h3>{a.kind === "invoice" ? `Invoice ${e?.buyerName ?? e?.buyerEmail}` : a.kind === "refund" ? `Refund ${e?.buyerName ?? "buyer"}${a.amount ? " " + usd(a.amount) : " in full"}` : `Pay out ${usd(a.amount ?? 0)} to ${a.receiver}`}</h3>
                      <p>{e ? `${e.item}. ` : ""}{a.reason}</p>
                    </div>
                  </div>
                  <div className="ac-foot">
                    <button className="bt bt-main bt-quiet" type="button" disabled={busy === a.id} onClick={() => runAction(a)}>{busy === a.id ? <><i className="bt-spin" />Working</> : live ? "Approve and send" : "Approve and preview"}</button>
                    <button className="bt bt-quiet" type="button" onClick={() => dismiss(a.id)}>Dismiss</button>
                  </div>
                  {o && <div className="ac-out" data-kind={o.mode} role="status">{o.text}{o.json !== undefined && <pre>{JSON.stringify(o.json, null, 2)}</pre>}</div>}
                </li>); })}
            </ul>
          </section>

          <section className="panel" aria-labelledby="rc-h">
            <div className="panel-h"><h2 id="rc-h">Reconcile</h2><small>Ledger against PayPal</small></div>
            <div className="cp-row" style={{ padding: 0 }}>
              <div>
                {live
                  ? <button className="bt bt-main" type="button" disabled={busy === "rec" || entries.length === 0} onClick={() => runRecon(false)}>{busy === "rec" ? <><i className="bt-spin" />Reading PayPal</> : "Reconcile with PayPal sandbox"}</button>
                  : <>
                    <button className="bt bt-main" type="button" disabled={busy === "rec" || entries.length === 0} onClick={() => runRecon(true)}>{busy === "rec" ? <><i className="bt-spin" />Matching</> : "Run on a sample tape"}</button>
                    <button className="bt" type="button" disabled={busy === "rec" || entries.length === 0} onClick={() => runRecon(false)}>Show the request</button>
                  </>}
              </div>
            </div>
            {rec?.source === "sample" && <p className="rc-src" role="note" style={{ marginTop: 12 }}>Sample tape: rows generated here from your direct sales plus one stray payment, shaped like Transaction Search output. This is not PayPal data. Add the sandbox keys for the real thing.</p>}
            {rec?.source === "paypal-sandbox" && <p className="rc-src" data-live="true" style={{ marginTop: 12 }}>Read {rec.count} transactions from the PayPal sandbox.</p>}
            {rec?.source === "none" && <p className="rc-src" style={{ marginTop: 12 }}>{rec.note}{rec.request ? <> Request it would send: <code className="num">{rec.request.method} {rec.request.url}</code></> : null}</p>}
            {rec?.result && (<>
              <div className="rc-stats"><div><span>Matched</span><b>{rec.result.matched.length}</b></div><div><span>Waiting</span><b>{rec.result.waiting.length}</b></div><div><span>Unknown</span><b>{rec.result.unknownPayments.length + rec.result.unknownRefunds.length}</b></div></div>
              <ul className="rc-lines">
                {rec.result.matched.map((m) => { const e = entries.find((x) => x.id === m.entryId); return <li key={m.transactionId}><span>{e?.item ?? m.entryId}</span><span className="num">fee {usd(m.fee)}{m.feeDelta ? ` (${m.feeDelta > 0 ? "+" : ""}${m.feeDelta.toFixed(2)} vs estimate)` : ""}</span></li>; })}
                {rec.result.unknownPayments.map((u) => <li key={u.transactionId}><span>Unknown payment{u.payer ? ` from ${u.payer}` : ""}</span><span className="num">{usd(u.amount)}</span></li>)}
                {rec.result.waiting.map((id) => <li key={id}><span>{entries.find((x) => x.id === id)?.item ?? id}</span><span>not on PayPal yet</span></li>)}
              </ul>
              {note?.summary && <div className="rc-note"><b>{note.summary}</b>{note.todo.length > 0 && <ul>{note.todo.map((t, i) => <li key={i}>{t}</li>)}</ul>}</div>}
            </>)}
          </section>
        </div>
      </main>
      <p className="ft-line">Built on the PayPal REST APIs (Invoicing v2, Payments v2 refunds, Payouts v1, Transaction Search v1, OAuth 2.0) with an Agnes language model. MIT licence. Fee rates are editable defaults, not advice.</p>
    </>
  );
}
