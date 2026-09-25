import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { parseAllDocuments } from "yaml";
import { openProject } from "@optiplanner/project";
import { resolveCatalog, compute } from "@optiplanner/engine";
import { catalogDir, examplesDir } from "@optiplanner/catalog";
const entries: unknown[] = [];
for (const f of readdirSync(catalogDir)) for (const d of parseAllDocuments(readFileSync(join(catalogDir, f), "utf8"))) { const v = d.toJS(); if (Array.isArray(v)) entries.push(...v); else if (v) entries.push(v); }
const { catalog, issues: ci } = resolveCatalog(entries);
console.log("catalog issues", ci);
function walk(dir: string, out: Record<string, string> = {}, base = dir) { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p, out, base); else if (e.name.endsWith(".yaml")) out[relative(base, p)] = readFileSync(p, "utf8"); } return out; }
for (const ex of readdirSync(examplesDir)) {
  const s = openProject("project.yaml", walk(join(examplesDir, ex)));
  const r = compute(s.model, catalog);
  console.log(`\n== ${ex}`, JSON.stringify(r.summary), s.issues);
  for (const sig of r.signals) console.log(`  ${sig.id.padEnd(28)} -> ${sig.rx ? sig.rx.node : sig.terminated}  P=${sig.powerAtEnd.min.toFixed(2)}/${sig.powerAtEnd.typ.toFixed(2)}/${sig.powerAtEnd.max.toFixed(2)} CD=${sig.cdAtEnd.toFixed(0)} ${sig.status}`);
  for (const a of r.amplifiers) console.log(`  amp ${a.id}: pin ${a.pinTotal.typ.toFixed(2)} G ${a.gainEffective.typ.toFixed(2)} pout ${a.poutTotal.typ.toFixed(2)} ${a.status}`);
  for (const i of r.issues.filter(i => i.severity !== "info")) console.log(`  [${i.severity}] ${i.code} ${i.element ?? ""} ${i.message}`);
}
