import { Document, YAMLMap, YAMLSeq, isMap, isSeq, parseAllDocuments } from "yaml";
import { CatalogEntryLoose } from "@lumantite/schema";
import type { Issue } from "@lumantite/schema";
import { normPath } from "./paths.js";
import { Tracker, detectFmt, getIn, jsOf, mk, render, syncMap } from "./roundtrip.js";
import type { Fmt } from "./roundtrip.js";

export interface CatalogSession {
  readonly entries: { file: string; entry: unknown; index: number }[];
  readonly issues: Issue[];
  upsert(file: string, entry: { kind: string; id: string } & Record<string, unknown>): void;
  remove(id: string): void;
  getFileText(path: string): string;
  setFileText(path: string, text: string): Issue[];
  changedFiles(): string[];
  serialize(): Record<string, string>;
  markSaved(paths?: string[]): void;
}

interface CatFile {
  path: string;
  text: string;
  saved: string | undefined;
  /** Documents of the stream (working copy; may gain/lose documents before the next render). */
  docs: Document[];
  tracker: Tracker;
  fmt: Fmt;
  /** "seq": one document whose root is a sequence of entries; "docs": one entry per document. */
  form: "seq" | "docs";
  /** Parse issues plus entry validation issues. */
  issues: Issue[];
  parseFailed: boolean;
  /** Valid loose entries; while the file has syntax errors, the last good set is kept. */
  good: { entry: unknown; index: number }[];
}

interface Loc { file: CatFile; index: number; map: YAMLMap; id: unknown }

function load(path: string, text: string, saved: string | undefined, prev?: CatFile): CatFile {
  const docs = Array.from(parseAllDocuments(text) as Document[]);
  const form = docs.length === 1 && isSeq(docs[0].contents) ? "seq" : "docs";
  const issues: Issue[] = [];
  for (const d of docs) for (const e of d.errors) {
    issues.push({
      severity: "error", code: "project.parse_error", element: path,
      message: `${path}: ${e.message.split("\n")[0]}`,
      ...(e.linePos ? { values: { line: e.linePos[0].line, col: e.linePos[0].col } } : {}),
    });
  }
  const f: CatFile = {
    path, text, saved, docs, tracker: new Tracker(text, docs), fmt: detectFmt(text), form, issues,
    parseFailed: issues.length > 0, good: [],
  };
  if (f.parseFailed) { f.good = prev?.good ?? []; return f; }
  for (const { index, node } of locate(f)) {
    let js: unknown;
    try { js = jsOf(node); } catch { js = undefined; }
    const r = CatalogEntryLoose.safeParse(js);
    if (r.success) { f.good.push({ entry: js, index }); continue; }
    const id = js && typeof js === "object" && typeof (js as { id?: unknown }).id === "string" ? (js as { id: string }).id : undefined;
    issues.push({
      severity: "error", code: "catalog.invalid_model", element: id ?? path,
      message: `${path} entry ${index}${id ? ` (${id})` : ""}: ${r.error.issues.map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    });
  }
  return f;
}

function locate(f: CatFile): { index: number; node: unknown }[] {
  if (f.form === "seq") {
    const seq = f.docs[0]?.contents;
    return isSeq(seq) ? seq.items.map((node, index) => ({ index, node })) : [];
  }
  return f.docs.map((d, index) => ({ index, node: d.contents })).filter((x) => x.node != null);
}

class Catalog implements CatalogSession {
  entries: { file: string; entry: unknown; index: number }[] = [];
  issues: Issue[] = [];
  private pool = new Map<string, CatFile>();

  constructor(files: Record<string, string>) {
    for (const [p, text] of Object.entries(files)) {
      const n = normPath(p);
      this.pool.set(n, load(n, text, text));
    }
    this.rebuild();
  }

  private rebuild(): void {
    const entries: typeof this.entries = [];
    const issues: Issue[] = [];
    for (const f of this.pool.values()) {
      issues.push(...f.issues);
      for (const g of f.good) entries.push({ file: f.path, entry: g.entry, index: g.index });
    }
    this.entries = entries;
    this.issues = issues;
  }

  private locs(): Loc[] {
    const out: Loc[] = [];
    for (const f of this.pool.values()) {
      if (f.parseFailed) continue;
      for (const { index, node } of locate(f)) if (isMap(node)) out.push({ file: f, index, map: node, id: jsOf(getIn(node, "id")) });
    }
    return out;
  }

  private commit(f: CatFile): void {
    const out = render(f.tracker, f.docs, f.fmt, true);
    const nf = load(f.path, out, f.saved, f);
    // keep the storage form stable for files that became empty
    if (nf.docs.length === 0) nf.form = f.form;
    this.pool.set(f.path, nf);
  }

  upsert(file: string, entry: { kind: string; id: string } & Record<string, unknown>): void {
    const obj: Record<string, unknown> = { kind: entry.kind, id: entry.id };
    for (const [k, v] of Object.entries(entry)) if (!(k in obj) && v !== undefined) obj[k] = v;
    const hit = this.locs().find((l) => l.id === entry.id);
    if (hit) {
      syncMap(hit.map, obj);
      this.commit(hit.file);
      this.rebuild();
      return;
    }
    const path = normPath(file);
    let f = this.pool.get(path);
    if (!f) { f = load(path, "", undefined); this.pool.set(path, f); }
    if (f.parseFailed) {
      this.rebuild();
      this.issues.push({ severity: "error", code: "project.parse_error", element: path, message: `${path}: cannot add "${entry.id}" while the file has YAML syntax errors` });
      return;
    }
    if (f.form === "seq") {
      const seq = f.docs[0].contents as YAMLSeq;
      if (seq.flow && seq.items.length === 0) seq.flow = false;
      const last = [...seq.items].reverse().find(isMap);
      seq.items.push(mk(obj, { flow: !!seq.flow || (last ? !!last.flow : false) }));
    } else {
      const d = new Document();
      d.contents = mk(obj) as Document["contents"];
      f.docs.push(d);
    }
    this.commit(f);
    this.rebuild();
  }

  remove(id: string): void {
    const hits = this.locs().filter((l) => l.id === id);
    if (!hits.length) return;
    const files = new Set<CatFile>();
    for (const h of hits) {
      files.add(h.file);
      if (h.file.form === "seq") {
        const seq = h.file.docs[0].contents as YAMLSeq;
        seq.items.splice(seq.items.indexOf(h.map), 1);
      } else {
        const i = h.file.docs.findIndex((d) => d.contents === h.map);
        if (i >= 0) h.file.docs.splice(i, 1);
      }
    }
    for (const f of files) this.commit(f);
    this.rebuild();
  }

  getFileText(path: string): string { return this.pool.get(normPath(path))?.text ?? ""; }

  setFileText(path: string, text: string): Issue[] {
    const n = normPath(path);
    const prev = this.pool.get(n);
    this.pool.set(n, load(n, text, prev?.saved, prev));
    this.rebuild();
    return this.issues.filter((i) => i.element === n || i.message.startsWith(`${n} `) || i.message.startsWith(`${n}:`));
  }

  changedFiles(): string[] {
    return [...this.pool.values()].filter((f) => f.text !== f.saved).map((f) => f.path);
  }

  serialize(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of this.pool.values()) out[f.path] = f.text;
    return out;
  }

  markSaved(paths?: string[]): void {
    const list = paths ? paths.map((p) => this.pool.get(normPath(p))) : [...this.pool.values()];
    for (const f of list) if (f) f.saved = f.text;
  }
}

/** Catalog files are either a top-level YAML sequence or multi-document (`---`) streams of entries. */
export function openCatalog(files: Record<string, string>): CatalogSession {
  return new Catalog(files);
}
