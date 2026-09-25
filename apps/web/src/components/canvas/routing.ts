/**
 * Canvas-wide fibre routing. Each edge reports its own right-angle route; this pulls apart
 * segments of different nets that would sit on (or right next to) each other into parallel
 * lanes, then works out the schematic junction dots on the result.
 */
import { create } from "zustand";
import { pathPoints, computeDots, type Pt } from "./branches";

export interface Route { id: string; net: string; pts: Pt[] }

/** Distance between parallel lanes, and how close two segments may run before they are split apart. */
export const LANE_GAP = 8;
/** Length of the fixed stub at each port; the rest of a route may be moved into a lane. */
const STUB = 16;
/** Shortest a segment next to a moved one may become. */
const MIN_LEG = 6;
const EPS = 0.5;

interface Seg { r: Route; i: number; v: boolean; c: number; lo: number; hi: number; fixed: boolean }

const vertical = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < EPS;
const same = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;

/**
 * Cut a long first/last leg into a short fixed stub, a zero-length jog, and a movable remainder,
 * so only the few px right at the port are pinned.
 */
function withStubs(pts: Pt[]): Pt[] {
  if (pts.length < 2) return pts;
  const cut = (a: Pt, b: Pt): Pt[] | null => {
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (len <= STUB + MIN_LEG) return null;
    const f = STUB / len;
    const s = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    return [s, { ...s }];
  };
  const head = cut(pts[0]!, pts[1]!);
  let out = head ? [pts[0]!, ...head, ...pts.slice(1)] : [...pts];
  const n = out.length;
  const tail = cut(out[n - 1]!, out[n - 2]!);
  if (tail) out = [...out.slice(0, n - 1), ...tail.reverse(), out[n - 1]!];
  return out;
}

/** Drop zero-length segments and straight-through points left over after nudging. */
function tidy(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && same(last, p)) continue;
    const prev = out[out.length - 2];
    if (prev && last && ((Math.abs(prev.x - last.x) < EPS && Math.abs(last.x - p.x) < EPS) || (Math.abs(prev.y - last.y) < EPS && Math.abs(last.y - p.y) < EPS))) out.pop();
    out.push(p);
  }
  return out;
}

/** Segments of one orientation; the first and last (the port stubs) are fixed. */
function segments(routes: Route[], v: boolean): Seg[] {
  const out: Seg[] = [];
  for (const r of routes) {
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [a, b] = [r.pts[i]!, r.pts[i + 1]!];
      if (same(a, b) || vertical(a, b) !== v) continue;
      const [p, q] = v ? [a.y, b.y] : [a.x, b.x];
      out.push({ r, i, v, c: v ? a.x : a.y, lo: Math.min(p, q), hi: Math.max(p, q), fixed: i === 0 || i + 2 === r.pts.length });
    }
  }
  return out;
}

/** Move segment i of a route to coordinate c without turning its neighbours back on themselves. */
function place(r: Route, i: number, v: boolean, c: number): void {
  const pts = r.pts;
  const keep = (far: Pt, near: Pt) => {
    const d = v ? near.x - far.x : near.y - far.y;
    if (Math.abs(d) < EPS) return;
    const base = v ? far.x : far.y;
    c = d > 0 ? Math.max(c, base + MIN_LEG) : Math.min(c, base - MIN_LEG);
  };
  if (i > 0) keep(pts[i - 1]!, pts[i]!);
  if (i + 2 < pts.length) keep(pts[i + 2]!, pts[i + 1]!);
  for (const k of [i, i + 1]) pts[k] = v ? { x: c, y: pts[k]!.y } : { x: pts[k]!.x, y: c };
}

/** Proper crossings between two routes (perpendicular segments meeting away from their ends). */
function crossings(a: Pt[], b: Pt[]): number {
  let n = 0;
  for (let i = 0; i + 1 < a.length; i++) {
    for (let j = 0; j + 1 < b.length; j++) {
      const [p, q, s, t] = [a[i]!, a[i + 1]!, b[j]!, b[j + 1]!];
      if (same(p, q) || same(s, t)) continue;
      const va = vertical(p, q);
      if (va === vertical(s, t)) continue;
      const [V1, V2, H1, H2] = va ? [p, q, s, t] : [s, t, p, q];
      const x = V1.x, y = H1.y;
      if (x > Math.min(H1.x, H2.x) + EPS && x < Math.max(H1.x, H2.x) - EPS && y > Math.min(V1.y, V2.y) + EPS && y < Math.max(V1.y, V2.y) - EPS) n++;
    }
  }
  return n;
}

/** One lane per net: segments of the same net may share a line (the dots show where they split). */
interface Lane { net: string; segs: Seg[]; c: number }

function spread(cluster: Seg[], gap: number): void {
  const fixed = cluster.filter((s) => s.fixed);
  const byNet = new Map<string, Seg[]>();
  for (const s of cluster) if (!s.fixed) byNet.set(s.r.net, [...(byNet.get(s.r.net) ?? []), s]);
  const lanes: Lane[] = [...byNet].map(([net, segs]) => ({ net, segs, c: segs.reduce((t, s) => t + s.c, 0) / segs.length }));
  const v = cluster[0]!.v;

  // order lanes: try both orders for each pair and keep the one with fewer crossings between them
  const cost = (lo: Lane, hi: Lane) => {
    const copy = (l: Lane, c: number) => l.segs.map((s) => {
      const r: Route = { ...s.r, pts: [...s.r.pts] };
      place(r, s.i, v, c);
      return r.pts;
    });
    const mid = (lo.c + hi.c) / 2;
    const a = copy(lo, mid - gap / 2);
    const b = copy(hi, mid + gap / 2);
    return a.reduce((t, p) => t + b.reduce((u, q) => u + crossings(p, q), 0), 0);
  };
  lanes.sort((a, b) => cost(a, b) - cost(b, a) || a.c - b.c || (a.net < b.net ? -1 : 1));

  // a lane can't sit on another net's pinned port stub that it runs alongside
  const blocked = (l: Lane, c: number) =>
    fixed.some((f) => f.r.net !== l.net && Math.abs(f.c - c) < gap - EPS && l.segs.some((s) => s.lo < f.hi - EPS && f.lo < s.hi - EPS));
  // lanes take increasing slots on a grid; try grids anchored on each existing line and keep the one that moves things least
  const anchors = [...new Set([...lanes.map((l) => l.c), ...fixed.map((f) => f.c)])];
  const reach = lanes.length + fixed.length + 1;
  let best: number[] | null = null;
  let bestCost = Infinity;
  for (const base of anchors) {
    for (let start = -reach; start <= reach; start++) {
      const slots: number[] = [];
      let m = start;
      for (const l of lanes) {
        while (blocked(l, base + m * gap) && m < start + 4 * reach) m++;
        slots.push(base + m * gap);
        m++;
      }
      const c = slots.reduce((t, x, k) => t + Math.abs(x - lanes[k]!.c) + (blocked(lanes[k]!, x) ? 1e6 : 0), 0);
      if (c < bestCost - EPS) { bestCost = c; best = slots; }
    }
  }
  lanes.forEach((l, k) => { for (const s of l.segs) place(s.r, s.i, v, best![k]!); });
}

/** Spread overlapping / crowded parallel segments of different nets into lanes `gap` apart. */
export function nudge(input: Route[], gap = LANE_GAP): Map<string, Pt[]> {
  const routes = input.map((r) => ({ ...r, pts: withStubs(r.pts.map((p) => ({ ...p }))) }));
  for (const v of [true, false]) {
    const segs = segments(routes, v).sort((a, b) => a.c - b.c);
    // cluster: segments closer than a lane that also run alongside each other
    const parent = segs.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length && segs[j]!.c - segs[i]!.c < gap - EPS; j++) {
        const [a, b] = [segs[i]!, segs[j]!];
        if (a.r !== b.r && a.lo < b.hi - EPS && b.lo < a.hi - EPS) parent[find(j)] = find(i);
      }
    }
    const clusters = new Map<number, Seg[]>();
    segs.forEach((s, i) => clusters.set(find(i), [...(clusters.get(find(i)) ?? []), s]));
    for (const c of clusters.values()) if (c.some((s) => !s.fixed) && new Set(c.map((s) => s.r.net)).size > 1) spread(c, gap);
  }
  return new Map(routes.map((r) => [r.id, tidy(r.pts)]));
}

/** Point halfway along a polyline, for the edge label. */
export function midpoint(pts: Pt[]): Pt {
  const len = (i: number) => Math.abs(pts[i + 1]!.x - pts[i]!.x) + Math.abs(pts[i + 1]!.y - pts[i]!.y);
  let rest = pts.slice(1).reduce((t, _, i) => t + len(i), 0) / 2;
  for (let i = 0; i + 1 < pts.length; i++) {
    const l = len(i);
    if (rest <= l && l > 0) {
      const f = rest / l;
      return { x: pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * f, y: pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * f };
    }
    rest -= l;
  }
  return pts[0] ?? { x: 0, y: 0 };
}

export interface Routed { d: string; lx: number; ly: number; dots: Pt[] }

interface RoutingState {
  base: Map<string, { net: string; d: string }>;
  routed: Map<string, Routed>;
  setRoute(id: string, net: string, d: string): void;
  removeRoute(id: string): void;
}

const toD = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");

let pending = false;
export const useRouting = create<RoutingState>()((set, get) => {
  const recompute = () => {
    const routes: Route[] = [...get().base].map(([id, b]) => ({ id, net: b.net, pts: pathPoints(b.d) }));
    const nudged = nudge(routes);
    const dots = computeDots(new Map(routes.map((r) => [r.id, { net: r.net, pts: nudged.get(r.id)! }])));
    const prev = get().routed;
    const routed = new Map<string, Routed>();
    for (const r of routes) {
      const pts = nudged.get(r.id)!;
      const m = midpoint(pts);
      const next: Routed = { d: toD(pts), lx: m.x, ly: m.y, dots: dots.get(r.id) ?? [] };
      const old = prev.get(r.id);
      // keep the old object when nothing moved, so that edge doesn't re-render
      const same = old && old.d === next.d && old.dots.length === next.dots.length && old.dots.every((p, i) => p.x === next.dots[i]!.x && p.y === next.dots[i]!.y);
      routed.set(r.id, same ? old : next);
    }
    set({ routed });
  };
  // many edges report in the same frame while dragging: recompute once per frame
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; recompute(); });
  };
  return {
    base: new Map(),
    routed: new Map(),
    setRoute: (id, net, d) => { get().base.set(id, { net, d }); schedule(); },
    removeRoute: (id) => { get().base.delete(id); schedule(); },
  };
});
