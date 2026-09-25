import { Document, Pair, Scalar, YAMLMap, YAMLSeq, isMap, isScalar, isSeq } from "yaml";
import {
  FibreInst, FragmentFile, Include, Margins, NodeInst, ProjectFile, ProjectMeta, Rect as RectSchema, Site,
  XY as XYSchema, parseEndpoint,
} from "@optiplanner/schema";
import type {
  FibreInst as FibreInstT, Issue, IssueCode, Margins as MarginsT, NodeInst as NodeInstT,
  ProjectMeta as ProjectMetaT, ProjectModel, Site as SiteT,
} from "@optiplanner/schema";
import { dirname, joinPath, normPath } from "./paths.js";
import {
  Tracker, deletePair, detectFmt, findPair, getIn, insertOrdered, jsOf, mk, parseDocumentCached, render, setKey,
  syncMap,
} from "./roundtrip.js";
import type { Fmt } from "./roundtrip.js";

export type XY = { x: number; y: number };
export type Rect = XY & { w: number; h: number };

/** A fibre to add: like `FibreInst`, but the `a`/`b` ends may be omitted (the schema defaults them to `{}`). */
export type NewFibre = Omit<FibreInstT, "a" | "b"> & Partial<Pick<FibreInstT, "a" | "b">>;

export type Op =
  | { op: "addNode"; file: string; node: NodeInstT; position?: XY }
  | { op: "updateNode"; id: string; patch: Partial<NodeInstT> }
  | { op: "deleteNode"; id: string }
  | { op: "addFibre"; file: string; fibre: NewFibre }
  | { op: "updateFibre"; id: string; patch: Partial<FibreInstT> }
  | { op: "deleteFibre"; id: string }
  | { op: "addSite"; file: string; site: SiteT; rect?: Rect }
  | { op: "updateSite"; id: string; patch: Partial<SiteT> }
  | { op: "deleteSite"; id: string }
  | { op: "renameId"; kind: "node" | "fibre" | "site"; from: string; to: string }
  | { op: "moveToFile"; kind: "node" | "fibre" | "site"; id: string; file: string }
  | { op: "setLayout"; kind: "node" | "site" | "file"; id: string; rect: XY | Rect }
  | { op: "setMargins"; margins: MarginsT }
  | { op: "setProjectMeta"; patch: Partial<ProjectMetaT> }
  | { op: "addFile"; file: string; label?: string }
  | { op: "removeFile"; file: string };

export interface ProjectSession {
  readonly rootFile: string;
  readonly model: ProjectModel;
  readonly issues: Issue[];
  apply(ops: Op[]): Issue[];
  setFileText(path: string, text: string): Issue[];
  getFileText(path: string): string;
  files(): string[];
  changedFiles(): string[];
  serialize(): Record<string, string>;
  markSaved(paths?: string[]): void;
}

// ------------------------------------------------------------------------------------------------

type Kind = "node" | "fibre" | "site";
const LIST: Record<Kind, "nodes" | "fibres" | "sites"> = { node: "nodes", fibre: "fibres", site: "sites" };
const TOP_ORDER = ["optiplanner", "includes", "project", "sites", "nodes", "fibres", "layout"] as const;
const NODE_ORDER = ["id", "name", "model", "site", "host", "slot", "settings", "x"];
const FIBRE_ORDER = ["id", "name", "type", "length_km", "a", "b", "attenuation_dB_per_km", "dispersion_ps_nm_km", "extra_loss_dB", "x"];
const SITE_ORDER = ["id", "name", "description", "parent", "x"];
const LAYOUT_ORDER = ["nodes", "sites", "files"];

interface FileState {
  /** Storage path (key of the `files` map given to openProject). */
  path: string;
  text: string;
  /** Text at open / last markSaved; undefined = not on disk yet. */
  saved: string | undefined;
  /** false for an include that was not supplied (listed, empty, not serialised until written). */
  exists: boolean;
  doc: Document.Parsed;
  tracker: Tracker;
  fmt: Fmt;
  parseIssues: Issue[];
  /** Last successfully parsed content (kept while the text has syntax errors). */
  js: unknown;
  /** Validation result cached per (js, role). */
  checked?: { js: unknown; key: string; v: Checked };
}

interface Checked {
  issues: Issue[];
  meta?: ProjectMetaT;
  sites: SiteT[];
  nodes: NodeInstT[];
  fibres: FibreInstT[];
  layout: { nodes: Record<string, XY>; sites: Record<string, Rect>; files: Record<string, Rect> };
}

interface Frag { model: string; storage: string; label?: string }
interface Target { state: FileState; model: string; frag?: Frag }
interface Found { t: Target; seq: YAMLSeq; index: number; map: YAMLMap }

class OpError extends Error {
  constructor(readonly issue: Issue) { super(issue.message); }
}
const fail = (code: IssueCode, message: string, element?: string): never => {
  throw new OpError({ severity: "error", code, message, ...(element !== undefined ? { element } : {}) });
};

function makeState(path: string, text: string, saved: string | undefined, exists: boolean, prevJs?: unknown): FileState {
  const st = { path, saved, exists } as FileState;
  loadText(st, text, prevJs);
  return st;
}

function loadText(st: FileState, text: string, prevJs?: unknown): void {
  const doc = parseDocumentCached(text);
  st.text = text;
  st.doc = doc;
  st.tracker = new Tracker(text, [doc]);
  st.fmt = detectFmt(text);
  st.parseIssues = doc.errors.map((e) => ({
    severity: "error" as const,
    code: "project.parse_error" as const,
    element: st.path,
    message: `${st.path}: ${e.message.split("\n")[0]}`,
    ...(e.linePos ? { values: { line: e.linePos[0].line, col: e.linePos[0].col } } : {}),
  }));
  if (doc.errors.length === 0) {
    try { st.js = doc.toJS(); } catch { st.js = prevJs; }
  } else st.js = prevJs;
}

function zodPath(path: readonly PropertyKey[], raw: unknown): string {
  let out = "";
  let cur: unknown = raw;
  for (const seg of path) {
    if (typeof seg === "number") {
      out += `[${seg}]`;
      cur = Array.isArray(cur) ? cur[seg] : undefined;
      const id = cur && typeof cur === "object" ? (cur as { id?: unknown }).id : undefined;
      if (typeof id === "string") out += ` (${id})`;
    } else {
      out += (out ? "." : "") + String(seg);
      cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[String(seg)] : undefined;
    }
  }
  return out || "(root)";
}

interface ZodLike { success: boolean; data?: unknown; error?: { issues: { path: PropertyKey[]; message: string }[] } }
function zodMessages(r: ZodLike, raw: unknown): string[] {
  return (r.error?.issues ?? []).map((i) => `${zodPath(i.path, raw)}: ${i.message}`);
}

function cleanObj<T extends object>(obj: T, order: string[], drop: string[] = []): Record<string, unknown> {
  const src = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const keys = [...order.filter((k) => k in src), ...Object.keys(src).filter((k) => !order.includes(k))];
  for (const k of keys) {
    if (drop.includes(k) || src[k] === undefined) continue;
    out[k] = src[k];
  }
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function checkNewId(id: unknown, what: string): string {
  if (typeof id !== "string" || id.length === 0) fail("project.invalid_op", `${what}: id must be a non-empty string`);
  if ((id as string).includes(".")) fail("project.invalid_op", `${what}: id "${id}" may not contain "."`, id as string);
  return id as string;
}

/** Validate one file's parsed content (cached until the content changes). */
function checkFile(st: FileState, isRoot: boolean): Checked {
  const key = isRoot ? "root" : "frag";
  if (st.checked && st.checked.js === st.js && st.checked.key === key) return st.checked.v;
  const path = st.path;
  const v: Checked = { issues: [], sites: [], nodes: [], fibres: [], layout: { nodes: {}, sites: {}, files: {} } };
  const issue = (message: string, severity: "error" | "warn" = "error") =>
    v.issues.push({ severity, code: "project.schema_error", element: path, message: `${path}: ${message}` });
  const raw = st.js ?? {};
  if (!isRecord(raw)) issue("top level must be a mapping");
  else {
    const full = (isRoot ? ProjectFile : FragmentFile).safeParse(raw) as ZodLike;
    for (const m of zodMessages(full, raw)) issue(m);
    if (!isRoot) for (const k of ["optiplanner", "includes", "project"]) {
      if (k in raw) issue(`"${k}" is only allowed in the parent file; ignored`, "warn");
    }
    const data = (full.success ? full.data : undefined) as ProjectFile | undefined;
    if (isRoot) {
      v.meta = data?.project ?? (ProjectMeta.safeParse(raw.project).data as ProjectMetaT | undefined)
        ?? { name: isRecord(raw.project) && typeof raw.project.name === "string" ? raw.project.name : "" };
    }
    const list = <T>(k: "sites" | "nodes" | "fibres", schema: { safeParse(x: unknown): { success: boolean; data?: unknown } }): T[] => {
      if (data) return (data[k] ?? []) as T[];
      const arr = raw[k];
      if (!Array.isArray(arr)) return [];
      return arr.map((x) => schema.safeParse(x)).filter((r) => r.success).map((r) => r.data as T);
    };
    v.sites = list<SiteT>("sites", Site);
    v.nodes = list<NodeInstT>("nodes", NodeInst);
    v.fibres = list<FibreInstT>("fibres", FibreInst);
    const lay = isRecord(raw.layout) ? raw.layout : {};
    for (const [sub, schema] of [["nodes", XYSchema], ["sites", RectSchema], ["files", RectSchema]] as const) {
      const rec = lay[sub];
      if (!isRecord(rec)) continue;
      for (const [id, x] of Object.entries(rec)) {
        const r = schema.safeParse(x);
        if (r.success) (v.layout[sub] as Record<string, unknown>)[id] = r.data;
      }
    }
  }
  st.checked = { js: st.js, key, v };
  return v;
}

// ------------------------------------------------------------------------------------------------

class Session implements ProjectSession {
  readonly rootFile: string;
  model!: ProjectModel;
  issues: Issue[] = [];
  private pool = new Map<string, FileState>();
  private frags: Frag[] = [];
  /** Containers auto-created during the current batch; dropped again if they end up empty. */
  private created: { parent: YAMLMap; pair: Pair }[] = [];
  private readonly baseDir: string;

  constructor(rootFile: string, files: Record<string, string>) {
    this.rootFile = normPath(rootFile);
    this.baseDir = dirname(this.rootFile);
    for (const [p, text] of Object.entries(files)) {
      const n = normPath(p);
      this.pool.set(n, makeState(n, text, text, true));
    }
    if (!this.pool.has(this.rootFile)) this.pool.set(this.rootFile, makeState(this.rootFile, "", undefined, false));
    this.rebuild();
  }

  // ---------------------------------------------------------------- files

  private get root(): FileState { return this.pool.get(this.rootFile)!; }

  private targets(): Target[] {
    return [
      { state: this.root, model: this.rootFile },
      ...this.frags.map((f) => ({ state: this.pool.get(f.storage)!, model: f.model, frag: f })),
    ];
  }

  private target(ref: string): Target | undefined {
    const n = normPath(ref);
    return this.targets().find((t) => t.model === n || t.state.path === n);
  }

  files(): string[] { return this.targets().map((t) => t.state.path); }

  getFileText(path: string): string {
    return (this.target(path)?.state ?? this.pool.get(normPath(path)))?.text ?? "";
  }

  changedFiles(): string[] {
    return this.targets().map((t) => t.state).filter((s) => s.exists && s.text !== s.saved).map((s) => s.path);
  }

  serialize(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const t of this.targets()) if (t.state.exists) out[t.state.path] = t.state.text;
    return out;
  }

  markSaved(paths?: string[]): void {
    const list = paths ? paths.map((p) => this.target(p)?.state ?? this.pool.get(normPath(p))) : this.targets().map((t) => t.state);
    for (const s of list) if (s && s.exists) s.saved = s.text;
  }

  setFileText(path: string, text: string): Issue[] {
    const t = this.target(path);
    if (!t) return [{ severity: "error", code: "project.file_unknown", element: path, message: `File "${path}" is not part of this project` }];
    loadText(t.state, text, t.state.js);
    t.state.exists = true;
    this.rebuild();
    return this.issues.filter((i) => i.element === t.state.path);
  }

  // ---------------------------------------------------------------- model

  private rebuild(): void {
    const issues: Issue[] = [];
    const root = this.root;
    if (!root.exists) issues.push({ severity: "error", code: "project.file_unknown", element: root.path, message: `Project file "${root.path}" not found` });
    issues.push(...root.parseIssues);

    const pjs = isRecord(root.js) ? root.js : {};
    // includes
    const frags: Frag[] = [];
    if (Array.isArray(pjs.includes)) {
      pjs.includes.forEach((inc: unknown) => {
        const r = Include.safeParse(inc);
        if (!r.success) return; // reported by the ProjectFile validation below
        const model = normPath(r.data.file);
        const storage = joinPath(this.baseDir, model);
        if (!model || storage === this.rootFile || frags.some((f) => f.storage === storage)) return;
        frags.push({ model, storage, ...(r.data.label !== undefined ? { label: r.data.label } : {}) });
      });
    }
    this.frags = frags;
    for (const f of frags) {
      if (!this.pool.has(f.storage)) this.pool.set(f.storage, makeState(f.storage, "", undefined, false));
      const st = this.pool.get(f.storage)!;
      if (!st.exists) issues.push({ severity: "error", code: "project.file_unknown", element: f.storage, message: `Included file "${f.model}" not found` });
      issues.push(...st.parseIssues);
    }

    const model: ProjectModel = {
      rootFile: this.rootFile,
      files: this.targets().map((t) => ({ path: t.model, ...(t.frag?.label !== undefined ? { label: t.frag.label } : {}) })),
      project: { name: "" },
      sites: [], nodes: [], fibres: [],
      layout: { nodes: {}, sites: {}, files: {} },
    };

    const own = { nodes: new Map<string, Record<string, XY>>(), sites: new Map<string, Record<string, Rect>>() };
    for (const t of this.targets()) {
      const isRoot = !t.frag;
      const c = checkFile(t.state, isRoot);
      issues.push(...c.issues);
      if (isRoot) model.project = c.meta ?? { name: "" };
      for (const x of c.sites) model.sites.push({ ...x, file: t.model });
      for (const x of c.nodes) model.nodes.push({ ...x, file: t.model });
      for (const x of c.fibres) model.fibres.push({ ...x, file: t.model });
      if (isRoot) {
        Object.assign(model.layout.nodes!, c.layout.nodes);
        Object.assign(model.layout.sites!, c.layout.sites);
        Object.assign(model.layout.files!, c.layout.files);
      } else {
        own.nodes.set(t.model, c.layout.nodes);
        own.sites.set(t.model, c.layout.sites);
      }
    }
    // fragments' own layout entries win over the parent's; entries for foreign ids are ignored
    for (const n of model.nodes) { const v = own.nodes.get(n.file)?.[n.id]; if (v) model.layout.nodes![n.id] = v; }
    for (const x of model.sites) { const v = own.sites.get(x.file)?.[x.id]; if (v) model.layout.sites![x.id] = v; }

    // duplicate ids
    const dup = (items: { id: string; file: string }[], what: string) => {
      const by = new Map<string, string[]>();
      for (const e of items) by.set(e.id, [...(by.get(e.id) ?? []), e.file]);
      for (const [id, fl] of by) if (fl.length > 1) {
        issues.push({ severity: "error", code: "project.duplicate_id", element: id, message: `Duplicate ${what} id "${id}" (${fl.join(", ")})` });
      }
    };
    dup([...model.nodes, ...model.fibres], "node/fibre");
    dup(model.sites, "site");

    this.model = model;
    this.issues = issues;
  }

  // ---------------------------------------------------------------- apply

  apply(ops: Op[]): Issue[] {
    const poolBefore = new Map(this.pool);
    const fragsBefore = this.frags.map((f) => ({ ...f }));
    const issues: Issue[] = [];
    this.created = [];
    for (const op of ops) {
      try { this.applyOp(op); }
      catch (e) {
        if (e instanceof OpError) issues.push(e.issue);
        else issues.push({ severity: "error", code: "project.invalid_op", message: `${op.op}: ${(e as Error).message}` });
      }
    }
    if (issues.length) {
      this.pool = poolBefore;
      this.frags = fragsBefore;
      for (const s of this.pool.values()) loadText(s, s.text, s.js);
      return issues;
    }
    for (const { parent, pair } of this.created.reverse()) {
      const v = pair.value;
      if ((isSeq(v) || isMap(v)) && v.items.length === 0 && parent.items.includes(pair)) {
        parent.items.splice(parent.items.indexOf(pair), 1);
      }
    }
    this.created = [];
    for (const s of new Set([...this.pool.values()])) {
      const out = render(s.tracker, [s.doc], s.fmt);
      if (out !== s.text || s.doc.contents !== s.tracker.roots[0]) {
        loadText(s, out, s.js);
        s.exists = true;
      }
    }
    this.rebuild();
    return [];
  }

  private applyOp(op: Op): void {
    switch (op.op) {
      case "addNode": return this.addElement("node", op.file, op.node, NODE_ORDER, NodeInst, op.position);
      case "addFibre": return this.addElement("fibre", op.file, op.fibre, FIBRE_ORDER, FibreInst);
      case "addSite": return this.addElement("site", op.file, op.site, SITE_ORDER, Site, op.rect);
      case "updateNode": return this.updateElement("node", op.id, op.patch as Record<string, unknown>, NodeInst);
      case "updateFibre": return this.updateElement("fibre", op.id, op.patch as Record<string, unknown>, FibreInst);
      case "updateSite": return this.updateElement("site", op.id, op.patch as Record<string, unknown>, Site);
      case "deleteNode": return this.deleteElement("node", op.id);
      case "deleteFibre": return this.deleteElement("fibre", op.id);
      case "deleteSite": return this.deleteElement("site", op.id);
      case "renameId": return this.renameId(op.kind, op.from, op.to);
      case "moveToFile": return this.moveToFile(op.kind, op.id, op.file);
      case "setLayout": return this.setLayout(op.kind, op.id, op.rect);
      case "setMargins": return this.setMargins(op.margins);
      case "setProjectMeta": return this.setProjectMeta(op.patch);
      case "addFile": return this.addFile(op.file, op.label);
      case "removeFile": return this.removeFile(op.file);
      default: fail("project.invalid_op", `Unknown op ${(op as { op: string }).op}`);
    }
  }

  // ---------------------------------------------------------------- lookup helpers

  private editable(t: Target): void {
    if (t.state.parseIssues.length) fail("project.parse_error", `${t.state.path} has YAML syntax errors; fix them in the YAML editor first`, t.state.path);
  }

  private needTarget(ref: string): Target {
    const t = this.target(ref);
    if (!t) fail("project.file_unknown", `File "${ref}" is not part of this project`, ref);
    this.editable(t!);
    return t!;
  }

  private rootMap(st: FileState, create: boolean): YAMLMap | undefined {
    const c = st.doc.contents;
    if (isMap(c)) return c;
    if (c == null || (isScalar(c) && c.value == null)) {
      if (!create) return undefined;
      const m = new YAMLMap();
      st.doc.contents = m as unknown as Document.Parsed["contents"];
      return m;
    }
    return fail("project.schema_error", `${st.path}: top level must be a mapping`, st.path);
  }

  private childColl(parent: YAMLMap, key: string, kind: "seq" | "map", create: boolean, order: readonly string[], path: string): YAMLSeq | YAMLMap | undefined {
    const pair = findPair(parent, key);
    const v = pair?.value;
    if (kind === "seq" ? isSeq(v) : isMap(v)) return v as YAMLSeq | YAMLMap;
    if (v == null || (isScalar(v) && v.value == null)) {
      if (!create) return undefined;
      const c = kind === "seq" ? new YAMLSeq() : new YAMLMap();
      if (parent.flow) c.flow = true;
      if (pair) pair.value = c;
      else this.created.push({ parent, pair: insertOrdered(parent, key, c, order) });
      return c;
    }
    return fail("project.schema_error", `${path}: "${key}" must be a ${kind === "seq" ? "list" : "mapping"}`, path);
  }

  private seqOf(st: FileState, key: string, create: boolean): YAMLSeq | undefined {
    const m = this.rootMap(st, create);
    return m ? (this.childColl(m, key, "seq", create, TOP_ORDER, st.path) as YAMLSeq | undefined) : undefined;
  }

  private layoutMap(st: FileState, sub: "nodes" | "sites" | "files", create: boolean): YAMLMap | undefined {
    const m = this.rootMap(st, create);
    if (!m) return undefined;
    const lay = this.childColl(m, "layout", "map", create, TOP_ORDER, st.path) as YAMLMap | undefined;
    return lay ? (this.childColl(lay, sub, "map", create, LAYOUT_ORDER, st.path) as YAMLMap | undefined) : undefined;
  }

  private *elements(kind: Kind): Generator<Found> {
    for (const t of this.targets()) {
      if (t.state.parseIssues.length) continue;
      const c = t.state.doc.contents;
      if (!isMap(c)) continue;
      const seq = getIn(c, LIST[kind]);
      if (!isSeq(seq)) continue;
      for (let i = 0; i < seq.items.length; i++) {
        const it = seq.items[i];
        if (isMap(it)) yield { t, seq, index: i, map: it };
      }
    }
  }

  private find(kind: Kind, id: string): Found | undefined {
    for (const f of this.elements(kind)) if (jsOf(getIn(f.map, "id")) === id) return f;
    for (const t of this.targets()) {
      const js = t.state.js;
      if (t.state.parseIssues.length && isRecord(js) && Array.isArray(js[LIST[kind]])
        && (js[LIST[kind]] as unknown[]).some((e) => isRecord(e) && e.id === id)) {
        this.editable(t);
      }
    }
    return undefined;
  }

  private need(kind: Kind, id: string): Found {
    const f = this.find(kind, id);
    if (!f) fail("project.invalid_op", `Unknown ${kind} "${id}"`, id);
    return f!;
  }

  private idTaken(kind: Kind, id: string): boolean {
    const kinds: Kind[] = kind === "site" ? ["site"] : ["node", "fibre"];
    if (kinds.some((k) => this.find(k, id))) return true;
    // also count elements of files that cannot be edited right now
    return this.targets().some((t) => t.state.parseIssues.length && isRecord(t.state.js)
      && kinds.some((k) => Array.isArray((t.state.js as Record<string, unknown>)[LIST[k]])
        && ((t.state.js as Record<string, unknown[]>)[LIST[k]]).some((e) => isRecord(e) && e.id === id)));
  }

  private *fibreEnds(): Generator<{ end: YAMLMap; to: string }> {
    for (const f of this.elements("fibre")) {
      for (const k of ["a", "b"]) {
        const end = getIn(f.map, k);
        if (!isMap(end)) continue;
        const to = jsOf(getIn(end, "to"));
        if (typeof to === "string") yield { end, to };
      }
    }
  }

  private layoutEntries(sub: "nodes" | "sites" | "files", key: string): { map: YAMLMap; pair: Pair; st: FileState }[] {
    const out: { map: YAMLMap; pair: Pair; st: FileState }[] = [];
    for (const t of this.targets()) {
      if (t.state.parseIssues.length) continue;
      const m = this.layoutMap(t.state, sub, false);
      const p = m && findPair(m, key);
      if (m && p) out.push({ map: m, pair: p, st: t.state });
    }
    return out;
  }

  private writeLayout(st: FileState, sub: "nodes" | "sites" | "files", key: string, value: Record<string, number>): void {
    const lm = this.layoutMap(st, sub, true)!;
    const pair = findPair(lm, key);
    if (pair && isMap(pair.value)) {
      for (const [k, v] of Object.entries(value)) setKey(pair.value, k, v);
    } else if (pair) {
      pair.value = mk(value, { flow: true });
    } else {
      lm.items.push(new Pair(new Scalar(key), mk(value, { flow: true })));
    }
  }

  // ---------------------------------------------------------------- element ops

  private addElement(kind: Kind, file: string, el: object, order: string[], schema: { safeParse(v: unknown): ZodLike }, rect?: XY | Rect): void {
    const t = this.needTarget(file);
    if (!isRecord(el)) fail("project.invalid_op", `add${kind}: element must be an object`);
    const obj = cleanObj(el, order, ["file"]);
    if (kind === "fibre") for (const k of ["a", "b"]) if (isRecord(obj[k]) && Object.keys(cleanObj(obj[k] as object, [])).length === 0) delete obj[k];
    const r = schema.safeParse(obj);
    if (!r.success) fail("project.invalid_op", `Invalid ${kind}: ${zodMessages(r, obj).join("; ")}`, typeof obj.id === "string" ? obj.id : undefined);
    const id = checkNewId(obj.id, `add ${kind}`);
    if (this.idTaken(kind, id)) fail("project.duplicate_id", `Id "${id}" is already used`, id);
    const seq = this.seqOf(t.state, LIST[kind], true)!;
    if (seq.flow && seq.items.length === 0) seq.flow = false;
    const lastMap = [...seq.items].reverse().find(isMap);
    const flow = !!seq.flow || (lastMap ? !!lastMap.flow : false);
    seq.items.push(mk(obj, { flow }));
    if (rect && kind === "node") this.writeLayout(t.state, "nodes", id, { x: rect.x, y: rect.y });
    if (rect && kind === "site") {
      const rr = RectSchema.safeParse(rect);
      if (!rr.success) fail("project.invalid_op", `Site rect needs x, y, w, h`, id);
      this.writeLayout(t.state, "sites", id, { x: rect.x, y: rect.y, w: (rect as Rect).w, h: (rect as Rect).h });
    }
  }

  private updateElement(kind: Kind, id: string, patch: Record<string, unknown>, schema: { safeParse(v: unknown): ZodLike }): void {
    const f = this.need(kind, id);
    this.editable(f.t);
    if (!isRecord(patch)) fail("project.invalid_op", `update ${kind}: patch must be an object`, id);
    if ("id" in patch && patch.id !== undefined && patch.id !== id) fail("project.invalid_op", `Use renameId to change the id of "${id}"`, id);
    for (const [k, v] of Object.entries(patch)) {
      if (k === "id" || k === "file") continue;
      if (kind === "fibre" && (k === "a" || k === "b") && isRecord(v)) {
        let end = getIn(f.map, k);
        if (!isMap(end)) {
          setKey(f.map, k, {});
          end = getIn(f.map, k);
        }
        for (const [ek, ev] of Object.entries(v)) setKey(end as YAMLMap, ek, ev);
        continue;
      }
      setKey(f.map, k, v);
    }
    const js = f.map.toJSON();
    const r = schema.safeParse(js);
    if (!r.success) fail("project.invalid_op", `update ${kind} "${id}": ${zodMessages(r, js).join("; ")}`, id);
  }

  private deleteElement(kind: Kind, id: string): void {
    const f = this.need(kind, id);
    this.editable(f.t);
    f.seq.items.splice(f.seq.items.indexOf(f.map), 1);
    if (kind === "node" || kind === "fibre") {
      for (const { end, to } of [...this.fibreEnds()]) if (parseEndpoint(to)?.element === id) deletePair(end, "to");
    }
    if (kind === "node") for (const e of this.layoutEntries("nodes", id)) deletePair(e.map, id);
    if (kind === "site") {
      for (const n of [...this.elements("node")]) if (jsOf(getIn(n.map, "site")) === id) deletePair(n.map, "site");
      for (const s of [...this.elements("site")]) if (jsOf(getIn(s.map, "parent")) === id) deletePair(s.map, "parent");
      for (const e of this.layoutEntries("sites", id)) deletePair(e.map, id);
    }
  }

  private renameId(kind: Kind, from: string, to: string): void {
    if (!["node", "fibre", "site"].includes(kind)) fail("project.invalid_op", `renameId: bad kind "${kind}"`);
    const f = this.need(kind, from);
    this.editable(f.t);
    checkNewId(to, "renameId");
    if (to === from) return;
    if (this.idTaken(kind, to)) fail("project.duplicate_id", `Id "${to}" is already used`, to);
    setKey(f.map, "id", to);
    const renameKey = (sub: "nodes" | "sites") => {
      for (const e of this.layoutEntries(sub, from)) {
        deletePair(e.map, to);
        if (isScalar(e.pair.key)) e.pair.key.value = to;
        else e.pair.key = new Scalar(to);
      }
    };
    if (kind !== "site") {
      for (const { end, to: ref } of [...this.fibreEnds()]) {
        const ep = parseEndpoint(ref);
        if (ep?.element === from) setKey(end, "to", `${to}.${ep.port}`);
      }
    }
    if (kind === "node") {
      for (const n of [...this.elements("node")]) if (jsOf(getIn(n.map, "host")) === from) setKey(n.map, "host", to);
      renameKey("nodes");
    }
    if (kind === "site") {
      for (const n of [...this.elements("node")]) if (jsOf(getIn(n.map, "site")) === from) setKey(n.map, "site", to);
      for (const s of [...this.elements("site")]) if (jsOf(getIn(s.map, "parent")) === from) setKey(s.map, "parent", to);
      renameKey("sites");
    }
  }

  private moveToFile(kind: Kind, id: string, file: string): void {
    const f = this.need(kind, id);
    this.editable(f.t);
    const t = this.needTarget(file);
    if (t.state === f.t.state) return;
    const idx = f.seq.items.indexOf(f.map);
    f.seq.items.splice(idx, 1);
    // A comment above the first item is attached to the sequence by the parser; it belongs to the item.
    if (idx === 0 && f.seq.commentBefore && !f.map.commentBefore) {
      f.map.commentBefore = f.seq.commentBefore;
      f.seq.commentBefore = undefined;
    }
    const seq = this.seqOf(t.state, LIST[kind], true)!;
    if (seq.flow && seq.items.length === 0) seq.flow = false;
    seq.items.push(f.map);
    const sub = kind === "node" ? "nodes" : kind === "site" ? "sites" : undefined;
    if (sub) {
      const src = this.layoutMap(f.t.state, sub, false);
      const pair = src && findPair(src, id);
      if (src && pair) {
        src.items.splice(src.items.indexOf(pair), 1);
        const dst = this.layoutMap(t.state, sub, true)!;
        deletePair(dst, id);
        dst.items.push(pair);
      }
    }
  }

  private setLayout(kind: "node" | "site" | "file", id: string, rect: XY | Rect): void {
    if (!XYSchema.safeParse(rect).success) fail("project.invalid_op", `setLayout: rect needs numeric x and y`, id);
    if (kind === "node") {
      const f = this.need("node", id);
      this.editable(f.t);
      this.writeLayout(f.t.state, "nodes", id, { x: rect.x, y: rect.y });
      return;
    }
    let st: FileState;
    let key: string;
    if (kind === "site") {
      const f = this.need("site", id);
      this.editable(f.t);
      st = f.t.state;
      key = id;
    } else if (kind === "file") {
      const t = this.target(id);
      if (!t) fail("project.file_unknown", `File "${id}" is not part of this project`, id);
      st = this.root;
      this.editable({ state: st, model: this.rootFile });
      key = t!.model;
    } else return fail("project.invalid_op", `setLayout: bad kind "${kind}"`);
    const value: Record<string, number> = { x: rect.x, y: rect.y };
    if ("w" in rect && "h" in rect) { value.w = rect.w; value.h = rect.h; }
    else {
      const cur = jsOf(getIn(this.layoutMap(st, kind === "site" ? "sites" : "files", false), key));
      if (!RectSchema.safeParse({ ...(isRecord(cur) ? cur : {}), ...value }).success) {
        fail("project.invalid_op", `setLayout: ${kind} "${id}" has no size yet; pass w and h`, id);
      }
    }
    this.writeLayout(st, kind === "site" ? "sites" : "files", key, value);
  }

  private projectMap(): YAMLMap {
    const t = { state: this.root, model: this.rootFile };
    this.editable(t);
    const root = this.rootMap(this.root, true)!;
    return this.childColl(root, "project", "map", true, TOP_ORDER, this.root.path) as YAMLMap;
  }

  private writeMargins(pm: YAMLMap, margins: unknown): void {
    if (margins === undefined) { deletePair(pm, "margins"); return; }
    const r = Margins.safeParse(margins);
    if (!r.success) fail("project.invalid_op", `Invalid margins: ${zodMessages(r as ZodLike, margins).join("; ")}`);
    const clean = cleanObj(margins as object, Object.keys(margins as object));
    const cur = getIn(pm, "margins");
    if (Object.keys(clean).length === 0) { deletePair(pm, "margins"); return; }
    if (isMap(cur)) { syncMap(cur, clean); return; }
    const node = mk(clean) as YAMLMap;
    node.flow = !!pm.flow;
    const pair = findPair(pm, "margins");
    if (pair) pair.value = node;
    else pm.items.push(new Pair(new Scalar("margins"), node));
  }

  private setMargins(margins: MarginsT): void {
    this.writeMargins(this.projectMap(), margins ?? {});
  }

  private setProjectMeta(patch: Partial<ProjectMetaT>): void {
    if (!isRecord(patch)) fail("project.invalid_op", "setProjectMeta: patch must be an object");
    const pm = this.projectMap();
    for (const [k, v] of Object.entries(patch)) {
      if (k === "margins") this.writeMargins(pm, v);
      else setKey(pm, k, v);
    }
    const js = pm.toJSON();
    const r = ProjectMeta.safeParse(js) as ZodLike;
    if (!r.success) fail("project.invalid_op", `Invalid project metadata: ${zodMessages(r, js).join("; ")}`);
  }

  // ---------------------------------------------------------------- file ops

  private addFile(file: string, label?: string): void {
    const model = normPath(file ?? "");
    if (!model) fail("project.invalid_op", "addFile: empty path");
    const storage = joinPath(this.baseDir, model);
    if (storage === this.rootFile || this.target(model) || this.frags.some((f) => f.storage === storage)) {
      fail("project.invalid_op", `File "${model}" is already part of this project`, model);
    }
    this.editable({ state: this.root, model: this.rootFile });
    const prev = this.pool.get(storage);
    if (!prev || !prev.exists) {
      const title = (label ?? model).replace(/[\r\n]+/g, " ");
      this.pool.set(storage, makeState(storage, `# ${title}\nnodes: []\nfibres: []\n`, prev?.saved, true));
    }
    const includes = this.seqOf(this.root, "includes", true)!;
    if (includes.flow && includes.items.length === 0) includes.flow = false;
    const lastMap = [...includes.items].reverse().find(isMap);
    const entry = { file: model, ...(label !== undefined ? { label } : {}) };
    includes.items.push(mk(entry, { flow: includes.flow || (lastMap ? !!lastMap.flow : true) }));
    this.frags.push({ model, storage, ...(label !== undefined ? { label } : {}) });
  }

  private removeFile(file: string): void {
    const t = this.target(file);
    if (!t) fail("project.file_unknown", `File "${file}" is not part of this project`, file);
    if (!t!.frag) fail("project.invalid_op", "The parent project file cannot be removed", t!.state.path);
    const st = t!.state;
    const js = st.parseIssues.length ? st.js : st.doc.toJS();
    const count = isRecord(js)
      ? (["sites", "nodes", "fibres"] as const).reduce((n, k) => n + (Array.isArray(js[k]) ? (js[k] as unknown[]).length : 0), 0)
      : 0;
    if (count > 0) fail("project.invalid_op", `File "${t!.model}" still holds ${count} element(s); move or delete them first`, st.path);
    this.editable({ state: this.root, model: this.rootFile });
    const includes = this.seqOf(this.root, "includes", false);
    if (includes) {
      const i = includes.items.findIndex((it) => isMap(it) && typeof jsOf(getIn(it, "file")) === "string"
        && joinPath(this.baseDir, normPath(jsOf(getIn(it, "file")) as string)) === st.path);
      if (i >= 0) includes.items.splice(i, 1);
    }
    const lf = this.layoutMap(this.root, "files", false);
    if (lf) deletePair(lf, t!.model);
    this.frags = this.frags.filter((f) => f !== t!.frag);
  }
}

// ------------------------------------------------------------------------------------------------

export function openProject(rootFile: string, files: Record<string, string>): ProjectSession {
  return new Session(rootFile, files);
}

export function newProjectText(name: string): string {
  const d = new Document();
  d.contents = new Scalar(String(name).replace(/[\r\n]+/g, " ")) as unknown as Document["contents"];
  const n = d.toString({ lineWidth: 0 }).trimEnd();
  return `optiplanner: 1\nproject:\n  name: ${n}\nsites: []\nnodes: []\nfibres: []\n`;
}

