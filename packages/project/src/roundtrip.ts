/**
 * Format-preserving serialisation for `yaml` Documents.
 *
 * Mutations are made with the `yaml` Document API (YAMLMap / YAMLSeq / Scalar nodes). To serialise,
 * the mutated tree is diffed against a snapshot taken when the text was parsed, and only the text
 * ranges of changed nodes are rewritten (splice). Everything else — comments, blank lines, key order,
 * flow/block style and even irregular spacing inside flow collections — is copied byte-for-byte from
 * the original text. New or replaced nodes are rendered with `Document#toString` in the file's own
 * indentation style. The result is re-parsed and compared with the mutated tree; if anything does not
 * match (an unsupported edit shape), the whole document falls back to `Document#toString`, which is
 * still comment-preserving, just less byte-faithful.
 */
import {
  Document, Pair, Scalar, YAMLMap, YAMLSeq,
  isAlias, isCollection, isMap, isNode, isPair, isScalar, isSeq,
  parseAllDocuments, parseDocument,
} from "yaml";
import type { ToStringOptions } from "yaml";

export interface Fmt {
  indent: number;
  indentSeq: boolean;
  flowCollectionPadding: boolean;
}

export function toStringOptions(fmt: Fmt): ToStringOptions {
  return { lineWidth: 0, indent: fmt.indent, indentSeq: fmt.indentSeq, flowCollectionPadding: fmt.flowCollectionPadding };
}

/** Guess the file's indentation conventions so inserted text matches its neighbours. */
export function detectFmt(text: string): Fmt {
  let indent = 0;
  for (const line of text.split("\n")) {
    const m = /^( +)[^ #\n]/.exec(line);
    if (m && (indent === 0 || m[1].length < indent)) indent = m[1].length;
  }
  if (indent < 2 || indent > 8) indent = 2;
  let indentSeq = true;
  const s = /^( *)[^ #\-\n][^\n]*:[ \t]*(?:#[^\n]*)?\n(?:[ \t]*(?:#[^\n]*)?\n)*( *)- /m.exec(text);
  if (s && s[1].length === s[2].length) indentSeq = false;
  const padded = (text.match(/[{[] [^\s\]}]/g) ?? []).length;
  const tight = (text.match(/[{[][^\s\]}]/g) ?? []).length;
  return { indent, indentSeq, flowCollectionPadding: padded >= tight };
}

// ------------------------------------------------------------------------------------------------
// Snapshot

interface Snap {
  value?: unknown;
  type?: string;
  flow?: boolean;
  items?: readonly unknown[];
  pairs?: Map<unknown, { key: unknown; value: unknown }>;
}

/** Which tracker (i.e. which original text) a node was parsed from. Used to move nodes verbatim. */
const owners = new WeakMap<object, Tracker>();

type Range3 = [number, number, number];
const rangeOf = (n: unknown): Range3 => {
  const r = (n as { range?: Range3 | null }).range;
  if (!r) throw new Fallback("node without range");
  return r;
};

class Fallback extends Error {}

/** Snapshot of parsed documents plus text-position helpers over their source. */
export class Tracker {
  readonly snaps = new Map<object, Snap>();
  readonly parent = new Map<object, object>();
  readonly origPair = new Map<object, { key: unknown; value: unknown }>();
  readonly roots: unknown[];
  readonly docs: readonly Document[];

  constructor(readonly text: string, docs: readonly Document[]) {
    this.docs = [...docs];
    this.roots = docs.map((d) => d.contents);
    for (const r of this.roots) this.snap(r, undefined);
  }

  private snap(n: unknown, parent: object | undefined): void {
    if (!n || typeof n !== "object") return;
    owners.set(n, this);
    if (parent) this.parent.set(n, parent);
    if (isScalar(n)) {
      this.snaps.set(n, { value: n.value, type: n.type });
    } else if (isSeq(n)) {
      this.snaps.set(n, { flow: !!n.flow, items: [...n.items] });
      for (const it of n.items) this.snap(it, n);
    } else if (isMap(n)) {
      const pairs = new Map<unknown, { key: unknown; value: unknown }>();
      for (const p of n.items) {
        pairs.set(p, { key: p.key, value: p.value });
        this.origPair.set(p, { key: p.key, value: p.value });
        this.parent.set(p, n);
        this.snap(p.key, n);
        this.snap(p.value, n);
      }
      this.snaps.set(n, { flow: !!n.flow, items: [...n.items], pairs });
    } else {
      this.snaps.set(n, {});
    }
  }

  /** True if the node and everything below it is unchanged since parsing. */
  pristine(n: unknown): boolean {
    if (n == null) return true;
    const s = this.snaps.get(n as object);
    if (!s) return false;
    if (isScalar(n)) return n.value === s.value && n.type === s.type;
    if (isSeq(n)) {
      return !!n.flow === s.flow && n.items.length === s.items!.length
        && n.items.every((it, i) => it === s.items![i] && this.pristine(it));
    }
    if (isMap(n)) {
      if (!!n.flow !== s.flow || n.items.length !== s.items!.length) return false;
      return n.items.every((p, i) => {
        const o = s.pairs!.get(p);
        return p === s.items![i] && !!o && o.key === p.key && o.value === p.value
          && this.pristine(p.key) && this.pristine(p.value);
      });
    }
    return true;
  }

  // ---- text helpers
  lineStart(p: number): number { return this.text.lastIndexOf("\n", p - 1) + 1; }
  lineEnd(p: number): number {
    const i = this.text.indexOf("\n", p);
    return i < 0 ? this.text.length : i + 1;
  }
  col(p: number): number { return p - this.lineStart(p); }
  ownLine(p: number): boolean { return /^[ \t]*$/.test(this.text.slice(this.lineStart(p), p)); }

  /** End of a node's own content (excludes trailing comment / newline). */
  /** End of a node's own content as originally parsed (excludes trailing comment / newline). */
  endOf(n: unknown): number {
    if (isCollection(n)) {
      const s = this.snaps.get(n);
      const items = s?.items ?? n.items;
      const flow = s ? s.flow : n.flow;
      if (!flow && items.length) return this.itemEnd(items[items.length - 1]);
    }
    return rangeOf(n)[1];
  }
  itemEnd(item: unknown): number {
    if (isPair(item)) {
      const o = this.origPair.get(item) ?? { key: item.key, value: item.value };
      return o.value != null ? this.endOf(o.value) : rangeOf(o.key)[1];
    }
    return this.endOf(item);
  }
  /** Start of an item: the `-` of a block seq item, the key of a pair, the node of a flow item. */
  itemStart(item: unknown, coll: YAMLMap | YAMLSeq, flow: boolean): number {
    if (isPair(item)) return rangeOf((this.origPair.get(item) ?? item).key)[0];
    const r0 = rangeOf(item)[0];
    if (flow || isMap(coll)) return r0;
    let p = r0;
    while (p > 0 && (this.text[p - 1] === " " || this.text[p - 1] === "\t")) p--;
    if (this.text[p - 1] !== "-") throw new Fallback("no dash");
    return p - 1;
  }
  /** Extend a line start upwards over comment lines at exactly the item's column. */
  commentTop(start: number): number {
    const c = this.col(start);
    let L = this.lineStart(start);
    while (L > 0) {
      const pL = this.lineStart(L - 1);
      const m = /^( *)#/.exec(this.text.slice(pL, L - 1));
      if (m && m[1].length === c) L = pL;
      else break;
    }
    return L;
  }
}

// ------------------------------------------------------------------------------------------------
// Rendering helpers

function withDoc(contents: unknown, fmt: Fmt): string {
  const d = new Document();
  d.contents = contents as Document["contents"];
  return d.toString(toStringOptions(fmt));
}

/** One-line flow rendering of a node (or pair) as it would appear inside a flow collection. */
export function inlineText(item: unknown, fmt: Fmt): string {
  let wrap: YAMLSeq | YAMLMap;
  if (isPair(item)) { wrap = new YAMLMap(); wrap.items.push(item); }
  else { wrap = new YAMLSeq(); wrap.items.push(item); }
  wrap.flow = true;
  const s = withDoc(wrap, fmt).replace(/\n$/, "");
  if (s.includes("\n")) throw new Fallback("multi-line inline");
  if (/^[[{] /.test(s) && / [\]}]$/.test(s)) return s.slice(2, -2);
  return s.slice(1, -1);
}

function scalarText(n: Scalar, fmt: Fmt): string {
  const c = new Scalar(n.value);
  if (n.type !== "BLOCK_FOLDED" && n.type !== "BLOCK_LITERAL") c.type = n.type;
  if (n.format) c.format = n.format;
  if (n.minFractionDigits) c.minFractionDigits = n.minFractionDigits;
  return inlineText(c, fmt);
}

function indentLines(body: string, col: number): string {
  const pad = " ".repeat(col);
  return body.split("\n").map((l) => (l.length ? pad + l : l)).join("\n");
}

function blockItems(items: unknown[], asMap: boolean, fmt: Fmt): string {
  const c = asMap ? new YAMLMap() : new YAMLSeq();
  (c.items as unknown[]).push(...items);
  return withDoc(c, fmt);
}

/** Block rendering of one seq item: copied verbatim when it was moved unchanged from another list. */
function seqItemText(item: unknown, fmt: Fmt): string {
  return verbatimSeqItem(item) ?? blockItems([item], false, fmt);
}

/** Block rendering of a node at column 0 (no trailing newline stripping). Seq items may be verbatim. */
function blockNodeText(node: unknown, fmt: Fmt): string {
  if (isSeq(node) && !node.flow && node.items.length) return node.items.map((it) => seqItemText(it, fmt)).join("");
  return withDoc(node, fmt);
}

/** Block rendering of a new map pair at column 0. */
function pairText(pair: Pair, fmt: Fmt): string {
  const v = pair.value;
  if (isSeq(v) && !v.flow && v.items.length && isScalar(pair.key) && !pair.key.commentBefore && !v.commentBefore && !v.comment) {
    const key = inlineText(pair.key, fmt);
    return `${key}:\n` + indentLines(blockNodeText(v, fmt), fmt.indentSeq ? fmt.indent : 0);
  }
  return blockItems([pair], true, fmt);
}

/** Text of a moved block-seq item copied from its original source, de-indented to column 0. */
function verbatimSeqItem(item: unknown): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const o = owners.get(item);
  const p = o?.parent.get(item);
  if (!o || !p || !isSeq(p) || o.snaps.get(p)?.flow || !o.pristine(item)) return undefined;
  try {
    const S = o.itemStart(item, p, false);
    if (!o.ownLine(S)) return undefined;
    const c = o.col(S);
    const body = o.text.slice(o.commentTop(S), o.lineEnd(o.itemEnd(item)));
    const lines = body.replace(/\n$/, "").split("\n");
    const out: string[] = [];
    for (const l of lines) {
      if (l.trim() === "") { out.push(""); continue; }
      if (l.slice(0, c).trim() !== "") return undefined;
      out.push(l.slice(c));
    }
    return out.join("\n") + "\n";
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------------------------------------------
// Diff → edits

interface Edit { from: number; to: number; text: string; seq: number }
type Ctx =
  | { kind: "root" }
  | { kind: "item"; inFlow: boolean }
  | { kind: "key" }
  | { kind: "pair"; inFlow: boolean; keyCol: number; keyEnd: number };

class Differ {
  readonly edits: Edit[] = [];
  constructor(private t: Tracker, private fmt: Fmt) {}

  private edit(from: number, to: number, text: string): void {
    this.edits.push({ from, to, text, seq: this.edits.length });
  }

  node(n: unknown, ctx: Ctx): void {
    if (n == null) return;
    const s = this.t.snaps.get(n as object);
    if (!s) throw new Fallback("unknown node");
    if (isScalar(n)) {
      if (n.value !== s.value || n.type !== s.type) {
        const r = rangeOf(n);
        this.edit(r[0], r[1], scalarText(n, this.fmt));
      }
      return;
    }
    if (!isCollection(n)) return;
    const orig = s.items!;
    const cur = n.items as unknown[];
    const coll = n as YAMLMap | YAMLSeq;
    // fast path: same items in the same order → only descend
    if (!!n.flow === s.flow && cur.length === orig.length && cur.every((x, i) => x === orig[i])) {
      if (cur.length) this.descend(cur, s, !!s.flow, coll);
      return;
    }
    // Items kept in place: the longest run of original items that still appear in original order
    // (greedy). Anything else counts as removed from its old position and inserted at its new one.
    const origIndex = new Map(orig.map((x, i) => [x, i] as const));
    const kept = new Set<unknown>();
    let lastIdx = -1;
    for (const x of cur) {
      const i = origIndex.get(x);
      if (i !== undefined && i > lastIdx) { kept.add(x); lastIdx = i; }
    }
    const keptCur = cur.filter((x) => kept.has(x));
    if (!!n.flow !== s.flow || (cur.length === 0 && orig.length > 0) || (cur.length > 0 && keptCur.length === 0)) {
      if (ctx.kind !== "pair") throw new Fallback("replace outside pair");
      this.replace(n, n, ctx);
      return;
    }
    if (cur.length === 0) return;
    const flow = !!s.flow;
    const t = this.t;

    // removals
    orig.forEach((it, i) => {
      if (kept.has(it)) return;
      if (flow) {
        if (i + 1 < orig.length) this.edit(t.itemStart(it, coll, true), t.itemStart(orig[i + 1], coll, true), "");
        else if (i > 0) this.edit(t.itemEnd(orig[i - 1]), t.itemEnd(it), "");
        else throw new Fallback("flow single removal");
        return;
      }
      const S = t.itemStart(it, coll, false);
      if (!t.ownLine(S)) {
        if (i + 1 < orig.length) this.edit(S, t.itemStart(orig[i + 1], coll, false), "");
        else throw new Fallback("inline last removal");
        return;
      }
      // Comment lines directly above an item belong to it — except above the first item of the
      // document's root collection, where they are the file header.
      const top = ctx.kind === "root" && i === 0 ? t.lineStart(S) : t.commentTop(S);
      this.edit(top, t.lineEnd(t.itemEnd(it)), "");
    });

    // insertions, grouped by the kept item they follow (undefined = before the first kept item)
    const groups: { after: unknown; items: unknown[] }[] = [];
    let last: unknown = undefined;
    for (const it of cur) {
      if (kept.has(it)) { last = it; continue; }
      const g = groups[groups.length - 1];
      if (g && g.after === last) g.items.push(it);
      else groups.push({ after: last, items: [it] });
    }
    for (const g of groups) {
      if (flow) {
        const parts = g.items.map((it) => inlineText(it, this.fmt));
        if (g.after !== undefined) this.edit(t.itemEnd(g.after), t.itemEnd(g.after), parts.map((p) => ", " + p).join(""));
        else {
          const p = t.itemStart(keptCur[0], coll, true);
          this.edit(p, p, parts.map((x) => x + ", ").join(""));
        }
        continue;
      }
      const anchor = g.after !== undefined ? g.after : keptCur[0];
      const S = t.itemStart(anchor, coll, false);
      const col = t.col(S);
      const body = g.items.map((it) => (isPair(it) ? pairText(it, this.fmt) : seqItemText(it, this.fmt))).join("");
      const text = indentLines(body, col);
      if (g.after !== undefined) {
        const pos = t.lineEnd(t.itemEnd(g.after));
        const nl = pos > 0 && t.text[pos - 1] !== "\n" ? "\n" : "";
        this.edit(pos, pos, nl + (nl ? text.replace(/\n$/, "") : text));
      } else {
        if (!t.ownLine(S)) throw new Fallback("head insert inline");
        // At document level the comment block above the first key is usually a file header: keep it on top.
        const pos = ctx.kind === "root" ? t.lineStart(S) : t.commentTop(S);
        this.edit(pos, pos, text);
      }
    }

    this.descend(keptCur, s, flow, coll);
  }

  private descend(keptCur: unknown[], s: Snap, flow: boolean, coll: YAMLMap | YAMLSeq): void {
    const t = this.t;
    for (const it of keptCur) {
      if (isPair(it)) {
        const o = s.pairs!.get(it)!;
        if (it.key !== o.key) {
          if (!isScalar(o.key)) throw new Fallback("key replaced");
          const r = rangeOf(o.key);
          const k = isScalar(it.key) ? it.key : new Scalar(it.key);
          this.edit(r[0], r[1], scalarText(k, this.fmt));
        } else this.node(it.key, { kind: "key" });
        const keyEnd = rangeOf(o.key)[1];
        const pctx: Ctx = flow
          ? { kind: "pair", inFlow: true, keyCol: 0, keyEnd }
          : { kind: "pair", inFlow: false, keyCol: t.col(t.itemStart(it, coll, false)), keyEnd };
        if (it.value !== o.value) {
          if (o.value == null || !isNode(o.value)) throw new Fallback("value from nothing");
          this.replace(o.value, it.value, pctx);
        } else if (o.value != null) this.node(o.value, pctx);
      } else {
        this.node(it, { kind: "item", inFlow: flow });
      }
    }
  }

  /** Replace the text of `old` (a pair value) with a rendering of `now`. */
  private replace(old: unknown, now: unknown, ctx: Ctx & { kind: "pair" }): void {
    const t = this.t;
    if (isAlias(old)) throw new Fallback("alias");
    const r0 = rangeOf(old)[0];
    const end = t.endOf(old);
    if (ctx.inFlow) { this.edit(r0, end, inlineText(now, this.fmt)); return; }
    const colon = t.text.indexOf(":", ctx.keyEnd);
    if (colon < 0 || colon > r0) throw new Fallback("no colon before value");
    const colonLineEnd = t.lineEnd(colon) - (t.text[t.lineEnd(colon) - 1] === "\n" ? 1 : 0);
    const onKeyLine = r0 <= colonLineEnd;
    const newBlock = isCollection(now) && !now.flow && now.items.length > 0;
    if (newBlock) {
      const col = ctx.keyCol + (isSeq(now) && !this.fmt.indentSeq ? 0 : this.fmt.indent);
      const body = "\n" + indentLines(blockNodeText(now, this.fmt).replace(/\n$/, ""), col);
      // keep a comment that follows the colon on the key line
      const emptyOld = isScalar(old) && old.value == null && rangeOf(old)[0] === rangeOf(old)[1];
      if (onKeyLine && !emptyOld) this.edit(colon + 1, end, body);
      else this.edit(colonLineEnd, Math.max(end, colonLineEnd), body);
    } else if (onKeyLine) {
      this.edit(colon + 1, end, " " + inlineText(now, this.fmt));
    } else {
      // old block value → inline value on the key line, keeping the key line's comment after it
      const tail = t.text.slice(colon + 1, colonLineEnd);
      this.edit(colon + 1, end, " " + inlineText(now, this.fmt) + tail);
    }
  }
}

function applyEdits(text: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => a.from - b.from || a.to - b.to || a.seq - b.seq);
  let out = "";
  let pos = 0;
  let lastRemoval = false;
  for (const e of sorted) {
    if (e.from < pos) {
      if (e.text === "" && lastRemoval) { pos = Math.max(pos, e.to); continue; }
      throw new Fallback("overlapping edits");
    }
    out += text.slice(pos, e.from) + e.text;
    pos = Math.max(pos, e.to);
    lastRemoval = e.text === "" && e.to > e.from;
  }
  return out + text.slice(pos);
}

// ------------------------------------------------------------------------------------------------
// Public API

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (a instanceof Map || b instanceof Map) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** The single-document parse made while verifying the last rendered text, reusable by the caller. */
let lastParsed: { text: string; doc: Document.Parsed } | undefined;

/** `parseDocument(text)`, reusing the parse done by the last `render` verification when it matches. */
export function parseDocumentCached(text: string): Document.Parsed {
  if (lastParsed && lastParsed.text === text) {
    const d = lastParsed.doc;
    lastParsed = undefined;
    return d;
  }
  return parseDocument(text);
}

function sameContent(text: string, docs: readonly Document[], multi: boolean): boolean {
  try {
    const parsed = multi ? Array.from(parseAllDocuments(text) as Document[]) : [parseDocument(text)];
    if (!multi) lastParsed = { text, doc: parsed[0] as Document.Parsed };
    const cur = multi ? docs.filter((d) => d.contents != null) : docs;
    const got = multi ? parsed.filter((d) => d.contents != null) : parsed;
    if (got.length !== cur.length) return false;
    return got.every((d, i) => d.errors.length === 0 && deepEqual(d.toJS(), cur[i].toJS()));
  } catch {
    return false;
  }
}

function plainString(docs: readonly Document[], fmt: Fmt): string {
  return docs.map((d, i) => {
    let s = d.toString(toStringOptions(fmt));
    if (i > 0 && !/^---/m.test(s)) s = "---\n" + s;
    return s;
  }).join("");
}

/**
 * Serialise `docs` (the current, possibly mutated documents of one file) against the original text
 * held by `t`. `docs` may drop original documents or append new ones (multi-document streams).
 */
export function render(t: Tracker, docs: readonly Document[], fmt: Fmt, multi = false): string {
  try {
    const d = new Differ(t, fmt);
    const kept = docs.filter((x) => t.docs.includes(x));
    const keptIdx = kept.map((x) => t.docs.indexOf(x));
    if (keptIdx.some((v, i) => i > 0 && v < keptIdx[i - 1])) throw new Fallback("doc order");
    const firstNew = docs.findIndex((x) => !t.docs.includes(x));
    if (firstNew >= 0 && docs.slice(firstNew).some((x) => t.docs.includes(x))) throw new Fallback("doc insert");
    t.docs.forEach((od, i) => {
      if (!docs.includes(od)) {
        const r = od.range as Range3;
        d.edits.push({ from: r[0], to: r[2], text: "", seq: d.edits.length });
        return;
      }
      if (od.contents !== t.roots[i]) throw new Fallback("root replaced");
      d.node(od.contents, { kind: "root" });
    });
    if (firstNew >= 0) {
      let tail = "";
      let count = kept.length;
      for (const nd of docs.slice(firstNew)) {
        const body = withDoc(nd.contents, fmt);
        tail += (count > 0 ? "---\n" : "") + (nd.commentBefore ? `#${nd.commentBefore.replace(/\n/g, "\n#")}\n` : "") + body;
        count++;
      }
      const nl = t.text.length && !t.text.endsWith("\n") ? "\n" : "";
      d.edits.push({ from: t.text.length, to: t.text.length, text: nl + tail, seq: d.edits.length });
    }
    if (d.edits.length === 0) return t.text;
    const out = applyEdits(t.text, d.edits);
    if (sameContent(out, docs, multi)) return out;
  } catch {
    // fall through
  }
  return plainString(docs, fmt);
}

// ------------------------------------------------------------------------------------------------
// Node construction / mutation helpers (Document API)

const isPlain = (v: unknown): boolean => v === null || typeof v !== "object";

export interface MkOpts { flow?: boolean; depth?: number }

/**
 * Build a YAML node from a plain value. Top level maps are block; nested maps whose values are all
 * scalars (or scalar lists) and scalar lists become flow (`{ to: A.tx }`, `[a, b]`) for compactness.
 */
export function mk(value: unknown, opts: MkOpts = {}): unknown {
  const depth = opts.depth ?? 0;
  if (isNode(value)) return value;
  if (isPlain(value)) return new Scalar(value);
  if (Array.isArray(value)) {
    const s = new YAMLSeq();
    s.flow = !!opts.flow || value.every(isPlain);
    for (const v of value) s.items.push(mk(v, { flow: s.flow, depth: depth + 1 }));
    return s;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  const m = new YAMLMap();
  m.flow = !!opts.flow || (depth > 0 && entries.length <= 8
    && entries.every(([, v]) => isPlain(v) || (Array.isArray(v) && v.every(isPlain))));
  for (const [k, v] of entries) m.items.push(new Pair(new Scalar(k), mk(v, { flow: m.flow, depth: depth + 1 })));
  return m;
}

export const keyOf = (p: Pair): unknown => (isScalar(p.key) ? p.key.value : p.key);

export function findPair(map: YAMLMap, key: string): Pair | undefined {
  return (map.items as Pair[]).find((p) => keyOf(p) === key);
}

export function getIn(map: unknown, key: string): unknown {
  if (!isMap(map)) return undefined;
  return findPair(map, key)?.value;
}

/** Plain JS view of a node (scalar value, or collection JSON). */
export function jsOf(n: unknown): unknown {
  if (isScalar(n)) return n.value;
  if (isNode(n)) return n.toJSON();
  return n;
}

export function deletePair(map: YAMLMap, key: string): boolean {
  const i = (map.items as Pair[]).findIndex((p) => keyOf(p) === key);
  if (i < 0) return false;
  map.items.splice(i, 1);
  return true;
}

/** Insert a new pair keeping a conventional key order (before the first later key present). */
export function insertOrdered(map: YAMLMap, key: string, value: unknown, order: readonly string[]): Pair {
  const pair = new Pair(new Scalar(key), value);
  const idx = order.indexOf(key);
  if (idx >= 0) {
    const at = (map.items as Pair[]).findIndex((p) => {
      const j = order.indexOf(String(keyOf(p)));
      return j > idx;
    });
    if (at >= 0) { map.items.splice(at, 0, pair); return pair; }
  }
  map.items.push(pair);
  return pair;
}

/** Set `key` to `value` with minimal node churn. `undefined` deletes the key. Objects are synced (replace semantics). */
export function setKey(map: YAMLMap, key: string, value: unknown): void {
  if (value === undefined) { deletePair(map, key); return; }
  const pair = findPair(map, key);
  if (!pair) {
    map.items.push(new Pair(new Scalar(key), mk(value, { flow: !!map.flow, depth: 1 })));
    return;
  }
  assignValue(pair, value, !!map.flow);
}

export function assignValue(pair: Pair, value: unknown, parentFlow: boolean): void {
  const cur = pair.value;
  if (isPlain(value)) {
    if (isScalar(cur)) {
      if (cur.value !== value) {
        if (typeof cur.value !== typeof value || cur.value === null || value === null) {
          cur.type = undefined;
          cur.format = undefined;
          cur.minFractionDigits = undefined;
        }
        cur.value = value;
      }
      return;
    }
    pair.value = new Scalar(value);
    return;
  }
  if (Array.isArray(value)) {
    if (isSeq(cur) && deepEqual(jsOf(cur), value)) return;
    pair.value = mk(value, { flow: parentFlow || (isSeq(cur) && !!cur.flow), depth: 1 });
    return;
  }
  if (isMap(cur)) { syncMap(cur, value as Record<string, unknown>); return; }
  pair.value = mk(value, { flow: parentFlow, depth: 1 });
}

/** Make `map` equal to `obj` (keys missing from obj are removed), touching only what differs. */
export function syncMap(map: YAMLMap, obj: Record<string, unknown>): void {
  for (const p of [...(map.items as Pair[])]) {
    const k = keyOf(p);
    if (typeof k !== "string" || !(k in obj) || obj[k] === undefined) map.items.splice(map.items.indexOf(p), 1);
  }
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) setKey(map, k, v);
}
