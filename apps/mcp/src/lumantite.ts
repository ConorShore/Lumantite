/**
 * File-system glue between the MCP tools and the pure packages: load a project and its catalog
 * from disk (same rules as the CLI), compute, and write edited files back.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseAllDocuments } from "yaml";
import { newProjectText, openProject, type Op, type ProjectSession } from "@lumantite/project";
import { compute, resolveCatalog, toMarkdown, toPortsCsv, toSignalsCsv, type Catalog } from "@lumantite/engine";
import { catalogDir, examplesDir } from "@lumantite/catalog";
import type { Issue, Results } from "@lumantite/schema";

export function readYamlDir(dir: string): Record<string, string> {
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

export function loadCatalog(dirs: string[]): { catalog: Catalog; issues: Issue[] } {
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

/** Catalog dirs for a project: the given ones (or the bundled starter catalog) plus `<project dir>/catalog`. */
export function catalogDirs(projectDir: string | undefined, dirs?: string[]): string[] {
  const base = dirs?.length ? dirs.map((d) => resolve(d)) : [catalogDir];
  return projectDir ? [...base, join(projectDir, "catalog")] : base;
}

export interface Loaded {
  session: ProjectSession;
  dir: string;
  catalog: Catalog;
  catalogIssues: Issue[];
}

export function loadProject(rootFile: string, dirs?: string[]): Loaded {
  const abs = resolve(rootFile);
  const dir = dirname(abs);
  const files = readYamlDir(dir);
  const root = relative(dir, abs);
  if (!(root in files)) throw new Error(`cannot read ${rootFile}`);
  const session = openProject(root, files);
  const { catalog, issues } = loadCatalog(catalogDirs(dir, dirs));
  return { session, dir, catalog, catalogIssues: issues };
}

export function run(l: Loaded): Results {
  return compute(l.session.model, l.catalog);
}

/** Compact overview: counts, per-signal one-liners, amplifier operating points and non-info issues. */
export function summarize(l: Loaded, results: Results) {
  const m = l.session.model;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    project: m.project.name,
    counts: { sites: m.sites.length, nodes: m.nodes.length, fibres: m.fibres.length, files: m.files.length },
    summary: results.summary,
    ok: [...l.catalogIssues, ...l.session.issues, ...results.issues].every((i) => i.severity !== "error"),
    signals: results.signals.map((s) => ({
      id: s.id,
      status: s.status,
      end: s.rx ? `${s.rx.node}.${s.rx.port}` : s.terminated,
      power_dBm: { min: r2(s.powerAtEnd.min), typ: r2(s.powerAtEnd.typ), max: r2(s.powerAtEnd.max) },
      cd_ps_nm: Math.round(s.cdAtEnd),
      failing: s.checks.filter((c) => c.status === "fail" || c.status === "warn").map((c) => `${c.code}: ${c.message}`),
    })),
    amplifiers: results.amplifiers.map((a) => ({
      id: a.id, mode: a.mode, status: a.status,
      pin_dBm: r2(a.pinTotal.typ), gain_dB: r2(a.gainEffective.typ), pout_dBm: r2(a.poutTotal.typ), headroom_dB: r2(a.headroom_dB),
    })),
    catalogIssues: l.catalogIssues,
    fileIssues: l.session.issues,
    issues: results.issues.filter((i) => i.severity !== "info"),
  };
}

export type ExportFormat = "md" | "ports_csv" | "signals_csv";

export function exportText(l: Loaded, results: Results, format: ExportFormat): { name: string; text: string } {
  const base = l.session.model.project.name.replace(/[^A-Za-z0-9_-]+/g, "_") || "project";
  switch (format) {
    case "md": return { name: `${base}.md`, text: toMarkdown(l.session.model, results) };
    case "ports_csv": return { name: `${base}-ports.csv`, text: toPortsCsv(results) };
    case "signals_csv": return { name: `${base}-signals.csv`, text: toSignalsCsv(results) };
  }
}

/** Apply edit ops atomically; on success (and not a dry run) write only the changed files, preserving comments. */
export function editProject(l: Loaded, ops: Op[], dryRun: boolean) {
  const issues = l.session.apply(ops);
  if (issues.some((i) => i.severity === "error")) return { applied: false, issues, changed: {} as Record<string, string> };
  const changed: Record<string, string> = {};
  for (const p of l.session.changedFiles()) changed[p] = l.session.getFileText(p);
  if (!dryRun) {
    for (const [p, text] of Object.entries(changed)) {
      const abs = join(l.dir, p);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, text);
    }
    l.session.markSaved();
  }
  return { applied: true, issues, changed };
}

export function createProject(path: string, name: string): string {
  const abs = resolve(path);
  if (existsSync(abs)) throw new Error(`${abs} already exists`);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, newProjectText(name));
  return abs;
}

export function listExamples(): { name: string; project: string }[] {
  return readdirSync(examplesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(examplesDir, e.name, "project.yaml")))
    .map((e) => ({ name: e.name, project: join(examplesDir, e.name, "project.yaml") }));
}
