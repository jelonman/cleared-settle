// Tiny validator for PayPal's official OpenAPI files in /spec. Flags unknown properties,
// missing required ones, wrong types, enum and maxLength violations, so request builders
// cannot drift from the documented shapes.
import fs from "node:fs";
import path from "node:path";

const cache: Record<string, any> = {};
export function loadSpec(name: string) {
  return (cache[name] ??= JSON.parse(fs.readFileSync(path.join(__dirname, "..", "spec", name), "utf8")));
}

function deref(spec: any, s: any): any {
  while (s && s.$ref) { let x = spec; for (const k of s.$ref.split("/").slice(1)) x = x[k]; s = x; }
  return s;
}

function merge(spec: any, s: any): any {
  s = deref(spec, s);
  if (!s.allOf) return s;
  const out: any = { ...s, properties: { ...(s.properties ?? {}) }, required: [...(s.required ?? [])] };
  for (const a of s.allOf) { const m = merge(spec, a); Object.assign(out.properties, m.properties ?? {}); out.required.push(...(m.required ?? [])); if (m.type && !out.type) out.type = m.type; }
  return out;
}

export function validate(spec: any, schema: any, value: any, at = "$"): string[] {
  const s = merge(spec, schema);
  const errs: string[] = [];
  if (value === undefined || value === null) return errs;
  if (s.enum && !s.enum.includes(value)) errs.push(`${at}: ${JSON.stringify(value)} not in enum ${JSON.stringify(s.enum)}`);
  if (s.type === "string") {
    if (typeof value !== "string") errs.push(`${at}: expected string`);
    else {
      if (s.maxLength !== undefined && value.length > s.maxLength) errs.push(`${at}: longer than maxLength ${s.maxLength}`);
      if (s.minLength !== undefined && value.length < s.minLength) errs.push(`${at}: shorter than minLength ${s.minLength}`);
      if (s.pattern) { try { if (!new RegExp(s.pattern).test(value)) errs.push(`${at}: ${JSON.stringify(value)} does not match ${s.pattern}`); } catch { /* unsupported pattern */ } }
    }
  } else if (s.type === "boolean") { if (typeof value !== "boolean") errs.push(`${at}: expected boolean`); }
  else if (s.type === "integer" || s.type === "number") { if (typeof value !== "number") errs.push(`${at}: expected number`); }
  else if (s.type === "array") {
    if (!Array.isArray(value)) errs.push(`${at}: expected array`);
    else value.forEach((v, i) => errs.push(...validate(spec, s.items ?? {}, v, `${at}[${i}]`)));
  } else if (s.properties || s.type === "object") {
    if (typeof value !== "object" || Array.isArray(value)) { errs.push(`${at}: expected object`); return errs; }
    for (const r of s.required ?? []) if (value[r] === undefined) errs.push(`${at}.${r}: required but missing`);
    for (const [k, v] of Object.entries(value)) {
      if (!s.properties || !(k in s.properties)) { if (s.properties) errs.push(`${at}.${k}: not a documented property`); continue; }
      errs.push(...validate(spec, s.properties[k], v, `${at}.${k}`));
    }
  }
  return errs;
}

export function requestSchema(spec: any, p: string, m: string) {
  return spec.paths[p][m].requestBody.content["application/json"].schema;
}
export function responseSchema(spec: any, p: string, m: string, code: string) {
  return spec.paths[p][m].responses[code].content["application/json"].schema;
}
