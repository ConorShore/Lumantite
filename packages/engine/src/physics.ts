import type { CheckStatus, FibreModel, NumOrRange, Range3, Triple, WlRow, WlSpec } from "@lumantite/schema";

// ---------------------------------------------------------------------------
// Power units
// ---------------------------------------------------------------------------

/** dBm → mW. */
export function dbmToMw(dbm: number): number {
  return Math.pow(10, dbm / 10);
}

/** mW → dBm. 0 mW → -Infinity. */
export function mwToDbm(mw: number): number {
  return 10 * Math.log10(mw);
}

/** 10·log10(Σ 10^(v/10)); -Infinity for an empty list. */
export function sumDbm(values: number[]): number {
  if (values.length === 0) return -Infinity;
  let s = 0;
  for (const v of values) s += Math.pow(10, v / 10);
  return 10 * Math.log10(s);
}

// ---------------------------------------------------------------------------
// Triples
// ---------------------------------------------------------------------------

export const triple = (v: number): Triple => ({ min: v, typ: v, max: v });
export const ZERO: Readonly<Triple> = Object.freeze({ min: 0, typ: 0, max: 0 });

/** Component-wise add: power + delta (delta.min is applied to the min case, etc.). */
export function addT(a: Triple, b: Triple): Triple {
  return { min: a.min + b.min, typ: a.typ + b.typ, max: a.max + b.max };
}

/** Component-wise difference a − b. */
export function subT(a: Triple, b: Triple): Triple {
  return { min: a.min - b.min, typ: a.typ - b.typ, max: a.max - b.max };
}

/** Sum of two loss triples (component-wise; both are {min,typ,max} *loss*). */
export function addLoss(a: Triple, b: Triple): Triple {
  return addT(a, b);
}

/** Scale a triple by a non-negative factor (e.g. dB/km × km). */
export function scaleT(a: Triple, k: number): Triple {
  return { min: a.min * k, typ: a.typ * k, max: a.max * k };
}

/**
 * Convert a *loss* triple (positive dB, {min,typ,max} of the loss) into the *delta* applied
 * to a power triple. Worst case convention: the **max loss** goes into the **min power** path,
 * the min loss into the max power path.
 */
export function lossToDelta(loss: Triple): Triple {
  return { min: -loss.max, typ: -loss.typ, max: -loss.min };
}

/**
 * Apply a loss to a power triple.
 *   min power ← power.min − loss.max
 *   typ power ← power.typ − loss.typ
 *   max power ← power.max − loss.min
 */
export function applyLoss(power: Triple, loss: Triple): Triple {
  return { min: power.min - loss.max, typ: power.typ - loss.typ, max: power.max - loss.min };
}

/**
 * Apply a gain *delta* (already arranged per case: gain.min is the gain applied in the min
 * power case) to a power triple.
 */
export function applyGain(power: Triple, gain: Triple): Triple {
  return addT(power, gain);
}

// ---------------------------------------------------------------------------
// Range3 / tables
// ---------------------------------------------------------------------------

/** Fill gaps of a Range3: typ ← (min+max)/2 if both, else whichever exists; min/max ← typ. */
export function fillRange3(r: Range3): Triple {
  let typ = r.typ;
  if (typ === undefined) {
    if (r.min !== undefined && r.max !== undefined) typ = (r.min + r.max) / 2;
    else typ = r.min ?? r.max ?? 0;
  }
  return { min: r.min ?? typ, typ, max: r.max ?? typ };
}

export function numOrRange(v: NumOrRange): Triple {
  return typeof v === "number" ? triple(v) : fillRange3(v);
}

export function isTable(spec: WlSpec): spec is WlRow[] {
  return Array.isArray(spec);
}

interface PreparedTable {
  nm: number[];
  min: number[];
  typ: number[];
  max: number[];
}
const tableCache = new WeakMap<object, PreparedTable>();

function prepare(rows: WlRow[]): PreparedTable {
  let p = tableCache.get(rows);
  if (p) return p;
  const sorted = [...rows].sort((a, b) => a.nm - b.nm);
  p = { nm: [], min: [], typ: [], max: [] };
  for (const r of sorted) {
    const t = numOrRange(r.value);
    p.nm.push(r.nm);
    p.min.push(t.min);
    p.typ.push(t.typ);
    p.max.push(t.max);
  }
  tableCache.set(rows, p);
  return p;
}

/** Index i such that xs[i] ≤ x ≤ xs[i+1] (xs sorted, length ≥ 2, x strictly inside). */
function segment(xs: number[], x: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

function interpArrays(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (n === 0) return 0;
  if (n === 1 || x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  const i = segment(xs, x);
  const x0 = xs[i];
  const x1 = xs[i + 1];
  if (x1 === x0) return ys[i];
  return ys[i] + ((ys[i + 1] - ys[i]) * (x - x0)) / (x1 - x0);
}

/**
 * Linear interpolation in wavelength. Outside the table the end value is returned (clamped);
 * use `inTableRange` to decide whether to raise `fibre.wavelength_out_of_table`.
 */
export function interp(table: { nm: number; value: number }[], nm: number): number {
  if (table.length === 0) return 0;
  let sorted = true;
  for (let i = 1; i < table.length; i++) if (table[i].nm < table[i - 1].nm) { sorted = false; break; }
  const rows = sorted ? table : [...table].sort((a, b) => a.nm - b.nm);
  return interpArrays(rows.map((r) => r.nm), rows.map((r) => r.value), nm);
}

/** Generic interpolation over (x, y) rows, clamped. Used for measured spectra and tilt tables. */
export function interpXY(xs: number[], ys: number[], x: number): number {
  return interpArrays(xs, ys, x);
}

/** [lowest nm, highest nm] of a wavelength table, or null for scalars/Range3. */
export function tableRange(spec: WlSpec | { nm: number }[]): [number, number] | null {
  if (!Array.isArray(spec) || spec.length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of spec) {
    if (r.nm < lo) lo = r.nm;
    if (r.nm > hi) hi = r.nm;
  }
  return [lo, hi];
}

/** True for scalars/Range3 and for tables whose range covers nm (single-row tables cover only their own nm). */
export function inTableRange(spec: WlSpec | { nm: number }[], nm: number): boolean {
  const r = tableRange(spec);
  if (!r) return true;
  if (Array.isArray(spec) && spec.length === 1) return true; // a single-row table is a constant
  return nm >= r[0] - 1e-9 && nm <= r[1] + 1e-9;
}

/**
 * Scalar / Range3 / wavelength table → {min, typ, max}.
 * Tables are interpolated per component; outside the table the end row is used (clamped).
 * With a table and no `nm`, the first (lowest-λ) row is used.
 */
export function resolveTriple(spec: WlSpec, nm?: number): Triple {
  if (typeof spec === "number") return triple(spec);
  if (!Array.isArray(spec)) return fillRange3(spec);
  const p = prepare(spec);
  if (p.nm.length === 0) return triple(0);
  const x = nm ?? p.nm[0];
  return {
    min: interpArrays(p.nm, p.min, x),
    typ: interpArrays(p.nm, p.typ, x),
    max: interpArrays(p.nm, p.max, x),
  };
}

// ---------------------------------------------------------------------------
// Fibre
// ---------------------------------------------------------------------------

/** Attenuation coefficient at λ, dB/km, as {min, typ, max}. */
export function attenuationAt(fibre: FibreModel, nm: number): Triple {
  return resolveTriple(fibre.attenuation_dB_per_km, nm);
}

/** Dispersion coefficient D(λ), ps/(nm·km). */
export function dispersionAt(fibre: FibreModel, nm: number): number {
  const d = fibre.dispersion;
  switch (d.model) {
    case "g652": {
      // D(λ) = S0/4 · (λ − λ0⁴/λ³)
      const l0 = d.zero_dispersion_nm;
      return (d.zero_dispersion_slope_ps_nm2_km / 4) * (nm - Math.pow(l0, 4) / Math.pow(nm, 3));
    }
    case "linear":
      return d.d0_ps_nm_km + d.slope_ps_nm2_km * (nm - d.at_nm);
    case "table":
      return resolveTriple(d.table, nm).typ;
    case "none":
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

export const EPS = 1e-9;

const RANK: Record<CheckStatus, number> = { "n/a": 0, pass: 1, warn: 2, fail: 3 };

export function worst(a: CheckStatus, b: CheckStatus): CheckStatus {
  return RANK[b] > RANK[a] ? b : a;
}

export function worstOf(list: CheckStatus[]): CheckStatus {
  let s: CheckStatus = "n/a";
  for (const x of list) s = worst(s, x);
  return s;
}

/** margin < 0 → fail; 0 ≤ margin < warnThreshold → warn; else pass. */
export function statusFromMargin(margin: number, warnThreshold: number): CheckStatus {
  if (margin < -EPS) return "fail";
  if (margin < warnThreshold - EPS) return "warn";
  return "pass";
}

/** Round for display. */
export function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
