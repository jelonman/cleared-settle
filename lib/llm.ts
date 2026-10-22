// Language steps use an OpenAI-compatible chat endpoint (owner's free Agnes key by default).
export interface LlmOptions { apiKey?: string; baseUrl?: string; model?: string; fetch?: typeof fetch }

export class LlmError extends Error { constructor(public code: string, m: string) { super(m); } }

export function llmConfigured(o: LlmOptions = {}) {
  return Boolean((o.apiKey ?? process.env.LLM_API_KEY ?? "").trim());
}

export async function chatJson<T>(system: string, user: string, o: LlmOptions = {}): Promise<T> {
  const key = (o.apiKey ?? process.env.LLM_API_KEY ?? "").trim();
  if (!key) throw new LlmError("LLM_KEY_MISSING", "LLM_API_KEY is not set.");
  const base = (o.baseUrl ?? process.env.LLM_BASE_URL ?? "https://apihub.agnes-ai.com/v1").replace(/\/$/, "");
  const model = o.model ?? process.env.LLM_MODEL ?? "agnes-2.5-flash";
  const f = o.fetch ?? fetch;
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await f(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 2500,
        messages: [
          { role: "system", content: system + "\nReply with one JSON object only. No prose, no code fences." },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) { last = new LlmError("LLM_HTTP", `LLM returned HTTP ${res.status}`); continue; }
    const body: any = await res.json();
    const text: string = body?.choices?.[0]?.message?.content ?? "";
    try { return parseJsonLoose<T>(text); } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new LlmError("LLM_PARSE", "LLM did not return JSON.");
}

export function parseJsonLoose<T>(text: string): T {
  const t = text.replace(/```(?:json)?/g, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) throw new LlmError("LLM_PARSE", "No JSON object in reply.");
  return JSON.parse(t.slice(start, end + 1)) as T;
}
