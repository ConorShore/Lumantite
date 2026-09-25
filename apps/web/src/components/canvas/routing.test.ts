import { describe, it, expect } from "vitest";
import { nudge, midpoint, LANE_GAP, type Route } from "./routing";
import type { Pt } from "./branches";

const P = (...xy: number[]): Pt[] => xy.flatMap((_, i) => (i % 2 ? [] : [{ x: xy[i]!, y: xy[i + 1]! }]));
const R = (id: string, net: string, ...xy: number[]): Route => ({ id, net, pts: P(...xy) });

describe("nudge", () => {
  it("pulls apart the shared middle leg of two different fibres into lanes", () => {
    // two Z routes from one column of ports to another, both turning at x=100
    const out = nudge([R("f1", "n1", 0, 0, 100, 0, 100, 100, 200, 100), R("f2", "n2", 0, 10, 100, 10, 100, 110, 200, 110)]);
    const x1 = out.get("f1")![1]!.x;
    const x2 = out.get("f2")![1]!.x;
    expect(Math.abs(x1 - x2)).toBe(LANE_GAP);
    // without crossing: the one starting higher turns further right
    expect(x1).toBeGreaterThan(x2);
    // still orthogonal
    for (const pts of out.values()) for (let i = 0; i + 1 < pts.length; i++) expect(pts[i]!.x === pts[i + 1]!.x || pts[i]!.y === pts[i + 1]!.y).toBe(true);
  });
  it("also separates legs that are merely close", () => {
    const out = nudge([R("f1", "n1", 0, 0, 100, 0, 100, 100, 200, 100), R("f2", "n2", 0, 50, 103, 50, 103, 150, 200, 150)]);
    expect(Math.abs(out.get("f1")![1]!.x - out.get("f2")![1]!.x)).toBe(LANE_GAP);
  });
  it("lets fibres of the same net share a lane", () => {
    const out = nudge([R("f1", "n1", 0, 0, 100, 0, 100, 100, 200, 100), R("f2", "n1", 0, 10, 100, 10, 100, 110, 200, 110)]);
    expect(out.get("f1")![1]!.x).toBe(100);
    expect(out.get("f2")![1]!.x).toBe(100);
  });
  it("leaves legs alone when they don't run alongside each other", () => {
    const out = nudge([R("f1", "n1", 0, 0, 100, 0, 100, 50, 200, 50), R("f2", "n2", 0, 60, 100, 60, 100, 110, 200, 110)]);
    expect(out.get("f1")![1]!.x).toBe(100);
    expect(out.get("f2")![1]!.x).toBe(100);
  });
  it("moves a long leg off another fibre's port stub, keeping the stub pinned", () => {
    // f1's last leg runs along y=100 right over f2's stub at the port (150,100)
    const out = nudge([R("f1", "n1", 0, 0, 20, 0, 20, 100, 300, 100), R("f2", "n2", 150, 100, 170, 100, 170, 200)]);
    const f1 = out.get("f1")!;
    const f2 = out.get("f2")!;
    expect(f2).toEqual(P(150, 100, 170, 100, 170, 200));
    expect(f1[f1.length - 1]).toEqual({ x: 300, y: 100 });
    // the long leg now runs a lane away, stepping back to y=100 only for the last stub into its port
    const leg = f1.slice(1, -2);
    expect(leg.every((p) => p.y === 0 || Math.abs(p.y - 100) >= LANE_GAP)).toBe(true);
  });
  it("never flips a port stub", () => {
    const routes = [0, 1, 2, 3, 4, 5].map((k) => R(`f${k}`, `n${k}`, 0, k * 20, 10, k * 20, 10, 200 + k * 20, 200, 200 + k * 20));
    for (const pts of nudge(routes).values()) expect(pts[1]!.x).toBeGreaterThan(pts[0]!.x);
  });
});

describe("midpoint", () => {
  it("is halfway along the route", () => {
    expect(midpoint(P(0, 0, 10, 0, 10, 10))).toEqual({ x: 10, y: 0 });
  });
});
