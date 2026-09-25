/**
 * Pure model → React Flow graph conversion. No physics: ports come from the engine adapter's
 * `portsOf`, colours are applied by the components from Results.
 */
import type { Node, Edge } from "@xyflow/react";
import { parseEndpoint } from "@lumantite/schema";
import type { DeviceModel, PortSpec, ProjectModel } from "@lumantite/schema";
import { portsOf, type Catalog } from "../../adapters/engine";

export type Inst = ProjectModel["nodes"][number];
export type FibreI = ProjectModel["fibres"][number];
export interface Rect { x: number; y: number; w: number; h: number }

export interface PortView { name: string; spec: PortSpec; side: "left" | "right"; top: number }
export interface DeviceData extends Record<string, unknown> {
  inst: Inst;
  model: DeviceModel | undefined;
  ports: PortView[];
  hiddenPorts: number;
  expandable: boolean;
}
export interface FrameData extends Record<string, unknown> { kind: "file" | "site"; id: string; label: string; sub?: string }
export interface JunctionData extends Record<string, unknown> { label: string }
/** `net`: fibres joined end-to-end (splices/connectors) share one, like a wire between two pins. */
export interface FibreData extends Record<string, unknown> { fibre: FibreI; label: string; net: string }

export const NODE_W = 170;
const HEADER_H = 34;
const ROW_H = 14;
const COLLAPSE_OVER = 12;
const ALWAYS_SHOWN = new Set(["common", "express", "monitor", "in", "out", "tx", "rx", "bidi"]);

export function nodeHeight(ports: PortView[]): number {
  const l = ports.filter((p) => p.side === "left").length;
  const r = ports.filter((p) => p.side === "right").length;
  return HEADER_H + Math.max(l, r, 1) * ROW_H + 8;
}

function sideOf(name: string, spec: PortSpec, model: DeviceModel, inst: Inst): "left" | "right" {
  // transceivers keep tx and rx together on one side unless the node asks to split them
  if (model.kind === "transceiver") {
    const s = inst.settings?.port_side ?? "right";
    if (s !== "split") return s;
  }
  if (spec.direction === "in") return "left";
  if (spec.direction === "out") return "right";
  if (model.kind === "mux") return spec.channel ? "left" : "right";
  if (model.kind === "passthrough") {
    const pair = (model.paths ?? [["in", "out"]]).find(([a, b]) => a === name || b === name);
    return pair && pair[0] === name ? "left" : "right";
  }
  return /^in/.test(name) ? "left" : "right";
}

export function devicePorts(inst: Inst, model: DeviceModel | undefined, catalog: Catalog, connected: Set<string>, expanded: boolean) {
  const all = model ? portsOf(model, catalog) : {};
  // also show ports that fibres reference but the model lacks (so the edge has a handle; engine reports the error)
  for (const c of connected) {
    const [node, port] = splitEndpoint(c);
    if (node === inst.id && port && !(port in all)) all[port] = { direction: "bidi", label: "?" };
  }
  const names = Object.keys(all);
  const collapse = !expanded && names.length > COLLAPSE_OVER;
  const shown = collapse ? names.filter((n) => ALWAYS_SHOWN.has(n) || connected.has(`${inst.id}.${n}`)) : names;
  const counts = { left: 0, right: 0 };
  const ports: PortView[] = shown.map((name) => {
    const spec = all[name]!;
    const side = model ? sideOf(name, spec, model, inst) : "right";
    const top = HEADER_H + counts[side]++ * ROW_H + ROW_H / 2;
    return { name, spec, side, top };
  });
  return { ports, hiddenPorts: names.length - shown.length, expandable: names.length > COLLAPSE_OVER };
}

function splitEndpoint(to: string): [string, string] {
  const ep = parseEndpoint(to);
  return ep ? [ep.element, ep.port] : [to, ""];
}

export function bbox(rects: Rect[], pad = 0): Rect | null {
  if (!rects.length) return null;
  const x0 = Math.min(...rects.map((r) => r.x)) - pad;
  const y0 = Math.min(...rects.map((r) => r.y)) - pad;
  const x1 = Math.max(...rects.map((r) => r.x + r.w)) + pad;
  const y1 = Math.max(...rects.map((r) => r.y + r.h)) + pad;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
/** Padding between a file frame's edge and the devices it holds. */
export const FILE_PAD = 40;
/** A file frame's rect: its stored rect grown to hold every member (or just the members' box). */
export function fileFrameRect(stored: Rect | undefined, members: Rect[]): Rect | null {
  const fit = bbox(members, FILE_PAD);
  return bbox([stored, fit].filter((r): r is Rect => !!r));
}
export const contains = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** Smallest rect containing the point. */
export function smallestContaining<T extends { rect: Rect }>(items: T[], x: number, y: number): T | undefined {
  let best: T | undefined;
  for (const it of items) if (contains(it.rect, x, y) && (!best || it.rect.w * it.rect.h < best.rect.w * best.rect.h)) best = it;
  return best;
}

export interface BuildOpts { showFileFrames: boolean; expanded: Record<string, boolean> }
export interface Graph {
  nodes: Node[];
  edges: Edge<FibreData>[];
  fileRects: { id: string; rect: Rect }[];
  siteRects: { id: string; rect: Rect }[];
}

export function buildGraph(model: ProjectModel, catalog: Catalog, opts: BuildOpts): Graph {
  const connected = new Set<string>();
  for (const f of model.fibres) for (const e of [f.a, f.b]) if (e?.to) connected.add(e.to);

  // ---- devices
  type Dev = { inst: Inst; data: DeviceData; rect: Rect; placed: boolean };
  const dev = new Map<string, Dev>();
  for (const inst of model.nodes) {
    const m = catalog.models.get(inst.model);
    const { ports, hiddenPorts, expandable } = devicePorts(inst, m, catalog, connected, !!opts.expanded[inst.id]);
    const pos = model.layout.nodes?.[inst.id];
    dev.set(inst.id, {
      inst,
      data: { inst, model: m, ports, hiddenPorts, expandable },
      rect: { x: pos?.x ?? 0, y: pos?.y ?? 0, w: NODE_W, h: nodeHeight(ports) },
      placed: !!pos,
    });
  }

  // ---- a node sitting in another file's frame had its file changed (inspector or YAML): re-place it in its own
  const storedFiles = model.layout.files ?? {};
  for (const d of dev.values()) {
    if (!d.placed) continue;
    const cx = d.rect.x + d.rect.w / 2;
    const cy = d.rect.y + d.rect.h / 2;
    const own = storedFiles[d.inst.file];
    if (own && contains(own, cx, cy)) continue;
    if (Object.entries(storedFiles).some(([f, r]) => f !== d.inst.file && contains(r, cx, cy))) d.placed = false;
  }

  // ---- auto-place nodes without layout: grid inside their file frame (below what's there), or right of everything
  const placedRects = [...dev.values()].filter((d) => d.placed).map((d) => d.rect);
  const extent = bbox([...placedRects, ...Object.values(storedFiles)]);
  let spill = extent ? extent.x + extent.w + 80 : 0;
  const byFile = new Map<string, Dev[]>();
  for (const d of dev.values()) if (!d.placed) byFile.set(d.inst.file, [...(byFile.get(d.inst.file) ?? []), d]);
  for (const [file, list] of byFile) {
    const fr = storedFiles[file];
    const held = bbox([...dev.values()].filter((d) => d.placed && d.inst.file === file).map((d) => d.rect));
    const x0 = fr ? fr.x + 20 : spill;
    const y0 = fr ? Math.max(fr.y + 40, held ? held.y + held.h + 30 : -Infinity) : 0;
    const cols = fr ? Math.max(1, Math.floor((fr.w - 20) / (NODE_W + 30))) : 3;
    list.forEach((d, i) => { d.rect.x = x0 + (i % cols) * (NODE_W + 30); d.rect.y = y0 + Math.floor(i / cols) * 130; });
    if (!fr) spill += cols * (NODE_W + 30) + 60;
  }

  // ---- frames
  const siteRects: Graph["siteRects"] = [];
  for (const s of model.sites) {
    const members = [...dev.values()].filter((d) => d.inst.site === s.id).map((d) => d.rect);
    const rect = model.layout.sites?.[s.id] ?? bbox(members, 24);
    if (rect) siteRects.push({ id: s.id, rect });
  }
  const fileRects: Graph["fileRects"] = [];
  let emptyX = spill;
  for (const f of model.files) {
    const members = [...dev.values()].filter((d) => d.inst.file === f.path).map((d) => d.rect);
    let rect = fileFrameRect(model.layout.files?.[f.path], members);
    if (!rect) { rect = { x: emptyX, y: -40, w: 260, h: 160 }; emptyX += 300; }
    fileRects.push({ id: f.path, rect });
  }

  const nodes: Node[] = [];
  if (opts.showFileFrames) {
    for (const { id, rect } of fileRects) {
      const f = model.files.find((x) => x.path === id)!;
      const isRoot = id === model.rootFile;
      nodes.push({
        id: `file:${id}`, type: "fileFrame", position: { x: rect.x, y: rect.y }, width: rect.w, height: rect.h,
        style: { width: rect.w, height: rect.h }, zIndex: 0, dragHandle: ".frame-grip",
        data: { kind: "file", id, label: f.label ?? id, sub: isRoot ? "parent" : id } satisfies FrameData,
      });
    }
  }
  for (const { id, rect } of siteRects) {
    const s = model.sites.find((x) => x.id === id)!;
    nodes.push({
      id: `site:${id}`, type: "siteFrame", position: { x: rect.x, y: rect.y }, width: rect.w, height: rect.h,
      style: { width: rect.w, height: rect.h }, zIndex: 1, dragHandle: ".frame-grip",
      data: { kind: "site", id, label: s.name ?? id, sub: s.name ? id : undefined } satisfies FrameData,
    });
  }
  for (const d of dev.values()) {
    nodes.push({ id: d.inst.id, type: "device", position: { x: d.rect.x, y: d.rect.y }, zIndex: 10, data: d.data, width: d.rect.w, height: d.rect.h });
  }

  // ---- fibres: endpoints are device handles, or junction nodes for fibre↔fibre joints / loose ends
  const fibreById = new Map(model.fibres.map((f) => [f.id, f]));
  const handlePos = (to: string): { x: number; y: number } | null => {
    const [node, port] = splitEndpoint(to);
    const d = dev.get(node);
    if (!d) return null;
    const p = d.data.ports.find((x) => x.name === port);
    return { x: d.rect.x + (p?.side === "left" ? 0 : d.rect.w), y: d.rect.y + (p?.top ?? 10) };
  };
  const junctionId = (f: string, end: string, g: string, gEnd: string) => {
    const [x, y] = [`${f}.${end}`, `${g}.${gEnd}`].sort();
    return `joint:${x}~${y}`;
  };
  const junctions = new Map<string, { x: number; y: number; label: string }>();
  const endPos = (f: FibreI, end: "a" | "b", depth = 0): { x: number; y: number } | null => {
    const to = f[end]?.to;
    if (!to || depth > 6) return null;
    const [el, port] = splitEndpoint(to);
    const g = fibreById.get(el);
    if (!g) return handlePos(to);
    const other = port === "a" ? "b" : "a";
    const p1 = endPos(f, end === "a" ? "b" : "a", depth + 1);
    const p2 = endPos(g, other, depth + 1);
    if (p1 && p2) return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    return p1 ?? p2;
  };
  const netOf = new Map<string, string>();
  const net = (id: string): string => { const p = netOf.get(id) ?? id; if (p === id) return id; const r = net(p); netOf.set(id, r); return r; };
  for (const f of model.fibres) for (const end of ["a", "b"] as const) {
    const to = f[end]?.to;
    const el = to ? splitEndpoint(to)[0] : undefined;
    if (el && fibreById.has(el) && net(el) !== net(f.id)) netOf.set(net(el), net(f.id));
  }
  const edges: Edge<FibreData>[] = [];
  const ends = new Map<string, { node: string; handle: string }[]>();
  for (const f of model.fibres) {
    const fe: { node: string; handle: string }[] = [];
    ends.set(f.id, fe);
    for (const end of ["a", "b"] as const) {
      const to = f[end]?.to;
      const other = end === "a" ? "b" : "a";
      if (to) {
        const [el, port] = splitEndpoint(to);
        if (dev.has(el)) { fe.push({ node: el, handle: port }); continue; }
        if (fibreById.has(el)) {
          const jid = junctionId(f.id, end, el, port);
          if (!junctions.has(jid)) {
            const p = endPos(f, end) ?? { x: 0, y: 0 };
            junctions.set(jid, { ...p, label: "splice" });
          }
          fe.push({ node: jid, handle: "j" });
          continue;
        }
      }
      // loose end: small stub next to the other end
      const jid = `loose:${f.id}.${end}`;
      const anchor = f[other]?.to ? handlePos(f[other]!.to!) : null;
      junctions.set(jid, { x: (anchor?.x ?? 0) + (end === "a" ? -70 : 70), y: (anchor?.y ?? 0) + 20, label: to ? `? ${to}` : "open" });
      fe.push({ node: jid, handle: "j" });
    }
  }

  // splices that land on top of each other (e.g. the two directions of a link) get nudged apart
  const JUNCTION_GAP = 16;
  const js = [...junctions.values()].sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 0; i < js.length; i++) {
    for (let k = 0; k < i; k++) {
      const [a, b] = [js[k]!, js[i]!];
      if (Math.abs(a.x - b.x) < JUNCTION_GAP && Math.abs(a.y - b.y) < JUNCTION_GAP) b.y = a.y + JUNCTION_GAP;
    }
  }
  // a fibre leaves a junction from the side facing its other end, so a splice reads as one line passing through
  const pos = (e: { node: string; handle: string }) => {
    const j = junctions.get(e.node);
    if (j) return j;
    const d = dev.get(e.node);
    const p = d?.data.ports.find((x) => x.name === e.handle);
    return d ? { x: d.rect.x + (p?.side === "left" ? 0 : d.rect.w), y: d.rect.y + (p?.top ?? 10) } : { x: 0, y: 0 };
  };
  for (const f of model.fibres) {
    const [a, b] = ends.get(f.id)!;
    for (const [e, o] of [[a!, b!], [b!, a!]] as const) if (junctions.has(e.node)) e.handle = pos(o).x < junctions.get(e.node)!.x ? "l" : "r";
    const t = catalog.models.get(f.type);
    const len = f.length_km ?? (t?.kind === "fibre" ? t.default_length_km : undefined);
    const label = `${f.id}${len !== undefined ? ` · ${len < 0.1 ? `${(len * 1000).toFixed(0)} m` : `${len} km`}` : ""}`;
    edges.push({
      id: f.id, type: "fibre", source: a!.node, sourceHandle: a!.handle, target: b!.node, targetHandle: b!.handle,
      zIndex: 5, data: { fibre: f, label, net: net(f.id) },
    });
  }
  for (const [id, j] of junctions) {
    nodes.push({ id, type: "junction", position: { x: j.x - 5, y: j.y - 5 }, zIndex: 11, draggable: false, selectable: false, data: { label: j.label } satisfies JunctionData, width: 10, height: 10 });
  }
  return { nodes, edges, fileRects, siteRects };
}
