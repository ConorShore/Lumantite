/**
 * Small inline test catalog matching the numbers used in SPEC §12:
 *   G.652.D: 0.20 dB/km @1550, 0.35 @1310/1383, 0.24 @1490, λ0 = 1310 nm, S0 = 0.092 ps/(nm²·km)
 *   LC/UPC {0.1, 0.25, 0.5} dB, fusion splice {0.02, 0.05, 0.1} dB, mux typ 3.0 dB.
 * Plus a few scalar / ideal variants so the hand arithmetic of T9–T19 can be reproduced exactly.
 */
import type { FibreInst, Issue, Margins, NodeInst, ProjectModel, Results, SignalResult } from "@optiplanner/schema";
import { expect } from "vitest";
import { resolveCatalog, type Catalog } from "../src/index.js";

// ---------------------------------------------------------------------------
// Wavelength plans
// ---------------------------------------------------------------------------
const dwdm100 = {
  kind: "wavelength-plan",
  id: "dwdm-c-100ghz-40",
  // C21 … C60 = 192.1 … 196.0 THz
  channels: Array.from({ length: 40 }, (_, i) => ({ id: `C${21 + i}`, frequency_GHz: 192100 + 100 * i })),
};
const dwdm50 = {
  kind: "wavelength-plan",
  id: "dwdm-c-50ghz-80",
  // 192.10 … 196.05 THz; ids C21, C21.5, C22 …
  channels: Array.from({ length: 80 }, (_, k) => ({
    id: k % 2 === 0 ? `C${21 + k / 2}` : `C${21 + (k - 1) / 2}.5`,
    frequency_GHz: 192100 + 50 * k,
  })),
};
const cwdm18 = {
  kind: "wavelength-plan",
  id: "cwdm-18",
  channels: Array.from({ length: 18 }, (_, i) => ({ id: String(1271 + 20 * i), wavelength_nm: 1271 + 20 * i })),
};

const rxStd = { sensitivity_dBm: -24, overload_dBm: -7, cd_tolerance_ps_nm: 1600, wavelength_range_nm: [1260, 1620] };

export const CATALOG_ENTRIES: unknown[] = [
  dwdm100,
  dwdm50,
  cwdm18,
  // ---- joints
  { kind: "joint", id: "lc-upc", family: "LC", polish: "UPC", insertion_loss_dB: { min: 0.1, typ: 0.25, max: 0.5 }, return_loss_dB: 50 },
  { kind: "joint", id: "sc-upc", family: "SC", polish: "UPC", insertion_loss_dB: { min: 0.1, typ: 0.25, max: 0.5 } },
  { kind: "joint", id: "fusion-splice", family: "splice", insertion_loss_dB: { min: 0.02, typ: 0.05, max: 0.1 } },
  /** LC with a scalar 0.25 dB (min = typ = max) — used where the SPEC arithmetic is typ-only. */
  { kind: "joint", id: "lc-s", family: "LC", insertion_loss_dB: 0.25 },
  /** Lossless LC mating — reproduces SPEC cases that ignore patch-cord connectors. */
  { kind: "joint", id: "lc-ideal", family: "LC", insertion_loss_dB: 0 },
  // ---- fibres
  {
    kind: "fibre",
    id: "g652d",
    attenuation_dB_per_km: [
      { nm: 1310, value: 0.35 },
      { nm: 1383, value: 0.35 },
      { nm: 1490, value: 0.24 },
      { nm: 1550, value: 0.2 },
      { nm: 1625, value: 0.22 },
    ],
    dispersion: { model: "g652", zero_dispersion_nm: 1310, zero_dispersion_slope_ps_nm2_km: 0.092 },
    max_power_dBm: 20,
    default_joint: "fusion-splice",
  },
  { kind: "fibre", id: "lc-patch", extends: "g652d", default_length_km: 0.002, default_joint: "lc-upc" },
  // ---- transceivers
  {
    kind: "transceiver",
    id: "grey-1550",
    tx: { wavelength: { wavelength_nm: 1550 }, power_dBm: 0 },
    rx: rxStd,
    connector: "lc-upc",
  },
  { kind: "transceiver", id: "grey-1550-t5", extends: "grey-1550", tx: { power_dBm: { min: 0, typ: 2, max: 4 } } },
  { kind: "transceiver", id: "grey-1310", extends: "grey-1550", tx: { wavelength: { wavelength_nm: 1310 } } },
  { kind: "transceiver", id: "grey-1528", extends: "grey-1550", tx: { wavelength: { wavelength_nm: 1528 } } },
  { kind: "transceiver", id: "grey-1271", extends: "grey-1550", tx: { wavelength: { wavelength_nm: 1271 } } },
  { kind: "transceiver", id: "grey-1566", extends: "grey-1550", tx: { wavelength: { wavelength_nm: 1566 } } },
  {
    kind: "transceiver",
    id: "cwdm-1471",
    tx: { wavelength: { plan: "cwdm-18", channel: "1471" }, power_dBm: 0 },
    rx: rxStd,
    connector: "lc-upc",
  },
  {
    kind: "transceiver",
    id: "dwdm-tunable",
    tx: { wavelength: { plan: "dwdm-c-100ghz-40", channels: "all" }, power_dBm: 0 },
    rx: { sensitivity_dBm: -14, overload_dBm: 0 },
    connector: "lc-upc",
  },
  {
    kind: "transceiver",
    id: "dwdm80-tunable",
    tx: { wavelength: { plan: "dwdm-c-50ghz-80", channels: "all" }, power_dBm: 0 },
    rx: { sensitivity_dBm: -24, overload_dBm: 0 },
    connector: "lc-upc",
  },
  {
    kind: "transceiver",
    id: "bidi-1310",
    tx: { wavelength: { wavelength_nm: 1310 }, power_dBm: 0 },
    rx: { sensitivity_dBm: -24, overload_dBm: -3, wavelength_range_nm: [1480, 1500] },
    ports: { bidi: { direction: "bidi" } },
    connector: "lc-upc",
  },
  {
    kind: "transceiver",
    id: "bidi-1490",
    tx: { wavelength: { wavelength_nm: 1490 }, power_dBm: 0 },
    rx: { sensitivity_dBm: -24, overload_dBm: -3, wavelength_range_nm: [1300, 1320] },
    ports: { bidi: { direction: "bidi" } },
    connector: "lc-upc",
  },
  // ---- muxes
  { kind: "mux", id: "mux40", plan: "dwdm-c-100ghz-40", channel_ports: "all", insertion_loss_dB: { min: 2.5, typ: 3.0, max: 3.5 }, connector: "lc-upc" },
  { kind: "mux", id: "mux40-s", plan: "dwdm-c-100ghz-40", channel_ports: "all", insertion_loss_dB: 3.0, connector: "lc-upc" },
  { kind: "mux", id: "mux80", plan: "dwdm-c-50ghz-80", channel_ports: "all", insertion_loss_dB: { min: 2.5, typ: 3.0, max: 3.5 }, connector: "lc-upc" },
  { kind: "mux", id: "oadm4", plan: "dwdm-c-100ghz-40", channel_ports: ["C21", "C22", "C23", "C24"], insertion_loss_dB: 3.0, connector: "lc-upc" },
  { kind: "mux", id: "oadm4-x", extends: "oadm4", express_port: { insertion_loss_dB: { typ: 1.0, max: 1.5 } } },
  { kind: "mux", id: "oadm-c21-x", plan: "dwdm-c-100ghz-40", channel_ports: ["C21"], insertion_loss_dB: 3.0, express_port: { insertion_loss_dB: 1.0 }, connector: "lc-upc" },
  { kind: "mux", id: "oadm-c22-x", extends: "oadm-c21-x", channel_ports: ["C22"] },
  { kind: "mux", id: "oadm-c30-x", extends: "oadm-c21-x", channel_ports: ["C30"] },
  // ---- amplifiers
  {
    kind: "amplifier",
    id: "edfa",
    band_nm: [1528, 1566],
    modes: ["constant_gain", "constant_output_power"],
    gain_dB: { min: 10, max: 23 },
    input_power_total_dBm: { min: -30, max: 5 },
    output_power_total_dBm: { max: 20 },
    connector: "lc-upc",
  },
  { kind: "amplifier", id: "edfa-flat1", extends: "edfa", gain_flatness_dB: 1.0 },
  {
    kind: "amplifier",
    id: "edfa-tilt",
    extends: "edfa",
    gain_tilt: [
      { nm: 1528, dB: 0.5 },
      { nm: 1566, dB: -0.5 },
    ],
  },
  {
    kind: "amplifier",
    id: "edfa-measured",
    extends: "edfa",
    gain_model: "measured",
    measurement_uncertainty_dB: 0.3,
    gain_spectrum: [
      { input_power_total_dBm: -20, gain_setting_dB: 20, spectrum: [{ nm: 1528, gain_dB: 20.6 }, { nm: 1547, gain_dB: 20.1 }, { nm: 1566, gain_dB: 19.4 }] },
      { input_power_total_dBm: -5, gain_setting_dB: 20, spectrum: [{ nm: 1528, gain_dB: 19.9 }, { nm: 1547, gain_dB: 20.0 }, { nm: 1566, gain_dB: 19.8 }] },
    ],
  },
  // ---- passives
  { kind: "dcm", id: "dcm-800", dispersion_ps_nm: -800, insertion_loss_dB: 3.0, connector: "lc-upc" },
  { kind: "attenuator", id: "att5", loss_dB: 5, connector: "lc-upc" },
  { kind: "splitter", id: "split-50", ratio: [50, 50], connector: "lc-upc" },
  { kind: "host", id: "host", slots: ["Eth1/1", "Eth1/2"] },
];

let cached: Catalog | undefined;
export function catalog(): Catalog {
  if (!cached) {
    const r = resolveCatalog(CATALOG_ENTRIES);
    if (r.issues.length) throw new Error("test catalog invalid: " + JSON.stringify(r.issues));
    cached = r.catalog;
  }
  return cached;
}

// ---------------------------------------------------------------------------
// Project builders
// ---------------------------------------------------------------------------
type N = Omit<NodeInst, "id" | "model"> & { id: string; model: string };
type F = Partial<FibreInst> & { id: string; type: string };

export function project(nodes: N[], fibres: F[], margins?: Margins): ProjectModel {
  const file = "project.yaml";
  return {
    rootFile: file,
    files: [{ path: file }],
    project: { name: "test", ...(margins ? { margins } : {}) },
    sites: [],
    nodes: nodes.map((n) => ({ ...n, file })),
    fibres: fibres.map((f) => ({ a: {}, b: {}, ...f, file })),
    layout: {},
  };
}

/** A fibre between two endpoints. */
export function fibre(id: string, type: string, a: string, b: string, extra: Partial<FibreInst> & { ja?: string; jb?: string } = {}): F {
  const { ja, jb, ...rest } = extra;
  return {
    id,
    type,
    a: { to: a, ...(ja ? { joint: ja } : {}) },
    b: { to: b, ...(jb ? { joint: jb } : {}) },
    ...rest,
  };
}

/** Lossless zero-length patch (lc-ideal both ends). */
export function ideal(id: string, a: string, b: string): F {
  return fibre(id, "lc-patch", a, b, { length_km: 0, ja: "lc-ideal", jb: "lc-ideal" });
}

export function sig(r: Results, id: string): SignalResult {
  const s = r.signals.find((x) => x.id === id);
  if (!s) throw new Error(`signal ${id} not found; have ${r.signals.map((x) => x.id).join(", ")}`);
  return s;
}

export function issues(r: Results | Issue[], code: string, element?: string): Issue[] {
  const list = Array.isArray(r) ? r : r.issues;
  return list.filter((i) => i.code === code && (element === undefined || i.element === element));
}

export function check(s: SignalResult, code: string) {
  const c = s.checks.find((x) => x.code === code);
  if (!c) throw new Error(`check ${code} not on ${s.id}: ${s.checks.map((x) => x.code).join(", ")}`);
  return c;
}

export function amp(r: Results, id: string) {
  const a = r.amplifiers.find((x) => x.id === id);
  if (!a) throw new Error(`amplifier ${id} not in results`);
  return a;
}

/** 0.01 dB tolerance → toBeCloseTo(x, 2) checks |Δ| < 0.005; we use explicit abs diff instead. */
export const DB = 0.01;
export const PSNM = 0.1;

/** |actual − expected| ≤ tol (default 0.01 dB). */
export function near(actual: number, expected: number, tol = DB): void {
  expect(Math.abs(actual - expected), `expected ${actual} ≈ ${expected} (±${tol})`).toBeLessThanOrEqual(tol);
}

/** Every component of a triple within tolerance. */
export function nearT(actual: { min: number; typ: number; max: number }, expected: { min: number; typ: number; max: number }, tol = DB): void {
  near(actual.min, expected.min, tol);
  near(actual.typ, expected.typ, tol);
  near(actual.max, expected.max, tol);
}
