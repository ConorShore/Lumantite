/**
 * Junction dots for orthogonal fibre routes, schematic style: where two routes of the same net
 * run together and then split (or one ends on the other), draw a dot. Crossings never get one.
 */
export interface Pt { x: number; y: number }
interface Route { net: string; pts: Pt[] }

const EPS = 0.5;
const near = (a: number, b: number) => Math.abs(a - b) < EPS;
const key = (p: Pt) => `${Math.round(p.x)},${Math.round(p.y)}`;

/** Vertices of an SVG path made of M/L/Q commands (zero-radius step path), minus duplicates and straight-through points. */
export function pathPoints(d: string): Pt[] {
  const n = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) {
    const p = { x: n[i]!, y: n[i + 1]! };
    const last = pts[pts.length - 1];
    if (last && near(last.x, p.x) && near(last.y, p.y)) continue;
    const prev = pts[pts.length - 2];
    if (prev && last && ((near(prev.x, last.x) && near(last.x, p.x)) || (near(prev.y, last.y) && near(last.y, p.y)))) pts.pop();
    pts.push(p);
  }
  return pts;
}

interface Seg { a: Pt; b: Pt; h: boolean }
const segsOf = (pts: Pt[]): Seg[] => pts.slice(1).map((b, i) => ({ a: pts[i]!, b, h: near(pts[i]!.y, b.y) }));
const lo = (s: Seg) => (s.h ? Math.min(s.a.x, s.b.x) : Math.min(s.a.y, s.b.y));
const hi = (s: Seg) => (s.h ? Math.max(s.a.x, s.b.x) : Math.max(s.a.y, s.b.y));
const onSeg = (p: Pt, s: Seg) => (s.h ? near(p.y, s.a.y) && p.x > lo(s) - EPS && p.x < hi(s) + EPS : near(p.x, s.a.x) && p.y > lo(s) - EPS && p.y < hi(s) + EPS);

/** Branch points between two routes: ends of the stretches they share, plus one route ending on the other. */
export function branchPoints(A: Pt[], B: Pt[]): Pt[] {
  const sa = segsOf(A);
  const sb = segsOf(B);
  const ends = new Map<string, { p: Pt; n: number }>();
  const add = (p: Pt) => { const k = key(p); const e = ends.get(k); if (e) e.n++; else ends.set(k, { p, n: 1 }); };
  for (const s of sa) {
    for (const t of sb) {
      if (s.h !== t.h || !(s.h ? near(s.a.y, t.a.y) : near(s.a.x, t.a.x))) continue;
      const [l, h] = [Math.max(lo(s), lo(t)), Math.min(hi(s), hi(t))];
      if (h - l < EPS) continue;
      add(s.h ? { x: l, y: s.a.y } : { x: s.a.x, y: l });
      add(s.h ? { x: h, y: s.a.y } : { x: s.a.x, y: h });
    }
  }
  // a shared stretch that turns a corner together yields its corner twice: not a branch
  const out = [...ends.values()].filter((e) => e.n === 1).map((e) => e.p);
  // one route ending part-way along the other (T)
  for (const [P, Q] of [[A, B], [B, A]] as const) {
    for (const p of [P[0], P[P.length - 1]]) if (p && segsOf(Q).some((s) => onSeg(p, s))) out.push(p);
  }
  // both routes ending on the same spot is a port or a splice, which already has its own mark
  const terminals = (r: Pt[]) => [r[0], r[r.length - 1]].filter(Boolean).map((p) => key(p!));
  const shared = new Set(terminals(A).filter((k) => terminals(B).includes(k)));
  const seen = new Set<string>();
  return out.filter((p) => { const k = key(p); if (shared.has(k) || seen.has(k)) return false; seen.add(k); return true; });
}

/** Dots per owning edge (the lowest id of the pair, so each dot is drawn once, under that edge's styling). */
export function computeDots(routes: Map<string, Route>): Map<string, Pt[]> {
  const byNet = new Map<string, string[]>();
  for (const [id, r] of routes) byNet.set(r.net, [...(byNet.get(r.net) ?? []), id]);
  const dots = new Map<string, Pt[]>();
  for (const ids of byNet.values()) {
    if (ids.length < 2) continue;
    ids.sort();
    const seen = new Set<string>();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        for (const p of branchPoints(routes.get(ids[i]!)!.pts, routes.get(ids[j]!)!.pts)) {
          if (seen.has(key(p))) continue;
          seen.add(key(p));
          dots.set(ids[i]!, [...(dots.get(ids[i]!) ?? []), p]);
        }
      }
    }
  }
  return dots;
}
