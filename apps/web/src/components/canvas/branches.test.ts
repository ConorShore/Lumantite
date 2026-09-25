import { describe, it, expect } from "vitest";
import { pathPoints, branchPoints, computeDots, type Pt } from "./branches";

const P = (...xy: number[]): Pt[] => xy.flatMap((_, i) => (i % 2 ? [] : [{ x: xy[i]!, y: xy[i + 1]! }]));

describe("pathPoints", () => {
  it("reads a zero-radius step path, dropping degenerate corners and straight-through points", () => {
    const d = "M212 143L 232,143Q 232,143 232,143L 232,123Q 232,123 232,123L 300,123L 380,123Q 380,123 380,123L380 143";
    expect(pathPoints(d)).toEqual(P(212, 143, 232, 143, 232, 123, 380, 123, 380, 143));
  });
});

describe("branchPoints", () => {
  it("marks where a shared stretch splits", () => {
    expect(branchPoints(P(0, 0, 100, 0), P(0, 0, 50, 0, 50, 40))).toEqual(P(50, 0));
  });
  it("ignores plain crossings", () => {
    expect(branchPoints(P(0, 0, 100, 0), P(50, -50, 50, 50))).toEqual([]);
  });
  it("follows a stretch round a shared corner and marks both ends", () => {
    const pts = branchPoints(P(0, 0, 50, 0, 50, 50), P(10, 0, 50, 0, 50, 30, 80, 30));
    expect(pts).toHaveLength(2);
    expect(pts).toEqual(expect.arrayContaining(P(10, 0, 50, 30)));
  });
  it("marks a route ending part-way along another", () => {
    expect(branchPoints(P(0, 0, 100, 0), P(50, 40, 50, 0))).toEqual(P(50, 0));
  });
  it("leaves routes that only meet at a common end (port or splice) alone", () => {
    expect(branchPoints(P(0, 0, 50, 0), P(50, 0, 50, 40))).toEqual([]);
  });
});

describe("computeDots", () => {
  it("only dots routes of the same net, once, on the lowest edge id", () => {
    const a = P(0, 0, 100, 0);
    const b = P(0, 0, 50, 0, 50, 40);
    expect(computeDots(new Map([["f1", { net: "x", pts: a }], ["f2", { net: "y", pts: b }]])).size).toBe(0);
    const dots = computeDots(new Map([["f2", { net: "x", pts: b }], ["f1", { net: "x", pts: a }], ["f3", { net: "x", pts: b }]]));
    expect([...dots]).toEqual([["f1", P(50, 0)]]);
  });
});
