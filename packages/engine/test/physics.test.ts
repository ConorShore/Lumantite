import { describe, expect, it } from "vitest";
import type { FibreModel } from "@lumantite/schema";
import {
  applyLoss,
  attenuationAt,
  dbmToMw,
  dispersionAt,
  interp,
  inTableRange,
  mwToDbm,
  resolveTriple,
  sumDbm,
} from "../src/index.js";
import { catalog, near, nearT, PSNM } from "./fixtures.js";

const g652d = () => catalog().models.get("g652d") as FibreModel;

describe("unit conversions", () => {
  it("dBm ↔ mW", () => {
    near(dbmToMw(0), 1, 1e-12);
    near(dbmToMw(10), 10, 1e-12);
    near(mwToDbm(2), 3.0103, 1e-4); // 10·log10(2) = 3.0103
    expect(mwToDbm(0)).toBe(-Infinity);
  });
  it("sumDbm", () => {
    expect(sumDbm([])).toBe(-Infinity);
    // 4 × 0 dBm = 10·log10(4) = 6.0206
    near(sumDbm([0, 0, 0, 0]), 6.0206, 1e-4);
    // T10: 10·log10(1 + 0.5012 + 0.2512 + 0.1) = 10·log10(1.8524) = 2.677
    near(sumDbm([0, -3, -6, -10]), 2.68);
  });
});

describe("resolveTriple", () => {
  it("scalar → min = typ = max", () => {
    expect(resolveTriple(0.25)).toEqual({ min: 0.25, typ: 0.25, max: 0.25 });
  });
  it("fills Range3 gaps", () => {
    // typ ← (min+max)/2 = (1 + 3)/2 = 2
    expect(resolveTriple({ min: 1, max: 3 })).toEqual({ min: 1, typ: 2, max: 3 });
    // min ← typ
    expect(resolveTriple({ typ: 1.0, max: 1.5 })).toEqual({ min: 1.0, typ: 1.0, max: 1.5 });
    // typ ← whichever exists, then max ← typ
    expect(resolveTriple({ min: 2 })).toEqual({ min: 2, typ: 2, max: 2 });
    expect(resolveTriple({ max: 4 })).toEqual({ min: 4, typ: 4, max: 4 });
  });
  it("interpolates table min/typ/max separately and clamps outside", () => {
    const t = [
      { nm: 1500, value: { min: 1, typ: 2, max: 3 } },
      { nm: 1600, value: { min: 3, typ: 4, max: 7 } },
    ];
    // at 1550 (midpoint): min (1+3)/2 = 2, typ (2+4)/2 = 3, max (3+7)/2 = 5
    expect(resolveTriple(t, 1550)).toEqual({ min: 2, typ: 3, max: 5 });
    // outside → end value
    expect(resolveTriple(t, 1400)).toEqual({ min: 1, typ: 2, max: 3 });
    expect(resolveTriple(t, 1700)).toEqual({ min: 3, typ: 4, max: 7 });
    expect(inTableRange(t, 1400)).toBe(false);
    expect(inTableRange(t, 1550)).toBe(true);
    expect(inTableRange(0.3, 1400)).toBe(true);
  });
  it("interp clamps", () => {
    const t = [
      { nm: 1310, value: 0.35 },
      { nm: 1550, value: 0.2 },
    ];
    near(interp(t, 1000), 0.35, 1e-12);
    near(interp(t, 2000), 0.2, 1e-12);
    // 1430 is halfway: (0.35 + 0.2)/2 = 0.275
    near(interp(t, 1430), 0.275, 1e-12);
  });
});

describe("applyLoss: max loss goes into the min power path", () => {
  it("T5 bracket arithmetic", () => {
    // Tx {0,2,4}; LC {0.1,0.25,0.5} ×2 = {0.2,0.5,1.0}; 10 km × 0.2 = 2.0
    // min = 0 − 2 − 1.0 = −3.0; typ = 2 − 2 − 0.5 = −0.5; max = 4 − 2 − 0.2 = 1.8
    const p = applyLoss(applyLoss({ min: 0, typ: 2, max: 4 }, { min: 0.2, typ: 0.5, max: 1.0 }), { min: 2, typ: 2, max: 2 });
    nearT(p, { min: -3.0, typ: -0.5, max: 1.8 });
  });
});

describe("fibre physics (G.652.D)", () => {
  it("T1: D(1550) = 0.023 × (1550 − 1310⁴/1550³) = 0.023 × 759.16 = 17.46 ps/(nm·km)", () => {
    near(dispersionAt(g652d(), 1550), 17.46, 0.005);
  });
  it("T2: D(1310) = 0 (λ = λ0)", () => {
    near(dispersionAt(g652d(), 1310), 0, 1e-9);
  });
  it("T4: attenuation at 1471 nm = 0.35 − 0.11 × (88/107) = 0.2595 dB/km", () => {
    // between 1383 (0.35) and 1490 (0.24): 0.35 − (0.35 − 0.24) × (1471 − 1383)/(1490 − 1383)
    near(attenuationAt(g652d(), 1471).typ, 0.2595, 1e-4);
  });
  it("attenuation at 1550 = 0.20, 1310 = 0.35", () => {
    nearT(attenuationAt(g652d(), 1550), { min: 0.2, typ: 0.2, max: 0.2 }, 1e-12);
    nearT(attenuationAt(g652d(), 1310), { min: 0.35, typ: 0.35, max: 0.35 }, 1e-12);
  });
  it("linear and table dispersion models", () => {
    const nz: FibreModel = { ...g652d(), dispersion: { model: "linear", d0_ps_nm_km: 4.0, at_nm: 1550, slope_ps_nm2_km: 0.085 } };
    // 4.0 + 0.085 × (1560 − 1550) = 4.85
    near(dispersionAt(nz, 1560), 4.85, 1e-9);
    const tb: FibreModel = { ...g652d(), dispersion: { model: "table", table: [{ nm: 1530, value: 16.5 }, { nm: 1565, value: 18.5 }] } };
    // 16.5 + 2.0 × (1547.5 − 1530)/35 = 17.5
    near(dispersionAt(tb, 1547.5), 17.5, PSNM);
  });
});
