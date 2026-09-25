#!/usr/bin/env node
import { Command } from "commander";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseAllDocuments } from "yaml";
import { openProject } from "@lumantite/project";
import { compute, resolveCatalog, toMarkdown, toPortsCsv, toSignalsCsv } from "@lumantite/engine";
import { catalogDir } from "@lumantite/catalog";
import type { Issue, Results } from "@lumantite/schema";

function readYamlDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ya?ml$/.test(e.name)) out[relative(dir, p)] = readFileSync(p, "utf8");
    }
  };
  if (statSync(dir, { throwIfNoEntry: false })?.isDirectory()) walk(dir);
  return out;
}

function loadCatalog(dirs: string[]) {
  const entries: unknown[] = [];
  for (const dir of dirs) {
    for (const text of Object.values(readYamlDir(dir))) {
      for (const doc of parseAllDocuments(text)) {
        const v = doc.toJS();
        if (Array.isArray(v)) entries.push(...v);
        else if (v && typeof v === "object") entries.push(v);
      }
    }
  }
  return resolveCatalog(entries);
}

function loadProject(rootFile: string) {
  const abs = resolve(rootFile);
  const dir = dirname(abs);
  const files = readYamlDir(dir);
  const root = relative(dir, abs);
  if (!(root in files)) throw new Error(`cannot read ${rootFile}`);
  return { session: openProject(root, files), dir };
}

function printIssues(issues: Issue[]) {
  for (const i of issues) {
    const where = [i.element, i.port, i.channel].filter(Boolean).join(" ");
    console.log(`  [${i.severity}] ${i.code}${where ? " " + where : ""}: ${i.message}`);
  }
}

function run(rootFile: string, opts: { catalog?: string[]; quiet?: boolean }): { results: Results; ok: boolean; model: ReturnType<typeof openProject>["model"] } {
  const { session, dir } = loadProject(rootFile);
  const dirs = [...(opts.catalog?.length ? opts.catalog : [catalogDir]), join(dir, "catalog")];
  const { catalog, issues: catalogIssues } = loadCatalog(dirs);
  const results = compute(session.model, catalog);
  const errors = [...catalogIssues, ...session.issues, ...results.issues].filter((i) => i.severity === "error");
  if (!opts.quiet) {
    console.log(`${session.model.project.name}: ${session.model.nodes.length} nodes, ${session.model.fibres.length} fibres, ${session.model.files.length} files`);
    if (catalogIssues.length) { console.log("catalog issues:"); printIssues(catalogIssues); }
    if (session.issues.length) { console.log("file issues:"); printIssues(session.issues); }
    const s = results.summary;
    console.log(`signals ${s.signals}: pass ${s.pass}, warn ${s.warn}, fail ${s.fail}; issues: ${s.errors} errors, ${s.warnings} warnings`);
    for (const sig of results.signals) {
      const p = sig.powerAtEnd;
      const end = sig.rx ? `${sig.rx.node}.${sig.rx.port}` : sig.terminated;
      console.log(`  ${sig.status.toUpperCase().padEnd(4)} ${sig.id.padEnd(32)} -> ${end.padEnd(24)} ${p.min.toFixed(2)} / ${p.typ.toFixed(2)} / ${p.max.toFixed(2)} dBm  CD ${sig.cdAtEnd.toFixed(0)} ps/nm`);
    }
    for (const a of results.amplifiers) {
      console.log(`  amp ${a.id}: ${a.mode} pin ${a.pinTotal.typ.toFixed(2)} gain ${a.gainEffective.typ.toFixed(2)} pout ${a.poutTotal.typ.toFixed(2)} dBm headroom ${a.headroom_dB.toFixed(2)} dB [${a.status}]`);
    }
    const shown = results.issues.filter((i) => i.severity !== "info");
    if (shown.length) { console.log("issues:"); printIssues(shown); }
  }
  return { results, ok: errors.length === 0, model: session.model };
}

const program = new Command().name("lumantite").description("Lumantite optical network planner CLI. Results are estimates provided without warranty; see DISCLAIMER.md.").version("0.1.0");

program
  .command("check")
  .description("Validate and compute a project; exit 1 on any error-severity issue")
  .argument("<project.yaml>")
  .option("-c, --catalog <dir...>", "catalog directory (default: bundled starter catalog)")
  .option("-q, --quiet", "print nothing, exit code only")
  .action((file: string, opts: { catalog?: string[]; quiet?: boolean }) => {
    const { ok } = run(file, opts);
    process.exit(ok ? 0 : 1);
  });

program
  .command("export")
  .description("Compute a project and write CSV / Markdown exports")
  .argument("<project.yaml>")
  .option("-f, --format <fmt>", "csv | md | all", "all")
  .option("-o, --out <dir>", "output directory", ".")
  .option("-c, --catalog <dir...>", "catalog directory")
  .action((file: string, opts: { format: string; out: string; catalog?: string[] }) => {
    const { results, model } = run(file, { catalog: opts.catalog, quiet: true });
    mkdirSync(opts.out, { recursive: true });
    const base = model.project.name.replace(/[^A-Za-z0-9_-]+/g, "_") || "project";
    const written: string[] = [];
    if (opts.format === "csv" || opts.format === "all") {
      writeFileSync(join(opts.out, `${base}-ports.csv`), toPortsCsv(results)); written.push(`${base}-ports.csv`);
      writeFileSync(join(opts.out, `${base}-signals.csv`), toSignalsCsv(results)); written.push(`${base}-signals.csv`);
    }
    if (opts.format === "md" || opts.format === "all") {
      writeFileSync(join(opts.out, `${base}.md`), toMarkdown(model, results)); written.push(`${base}.md`);
    }
    for (const w of written) console.log(`wrote ${join(opts.out, w)}`);
  });

program.parseAsync(process.argv).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(2);
});
