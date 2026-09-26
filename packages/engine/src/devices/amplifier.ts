import type {
  AmpMode,
  AmplifierModel,
  Channel,
  Check,
  CheckStatus,
  GainSpectrumPoint,
  Issue,
  NodeSettings,
  Triple,
} from "@lumantite/schema";
import type { NodeInfo } from "../graph.js";
import { EPS, interpXY, statusFromMargin, sumDbm, worstOf } from "../physics.js";
import { failTerm, type RouteOut, type RouteSig } from "./types.js";

/** Amplifiers are unidirectional in → out; arriving anywhere else is a direction conflict. */
export function routeAmplifier(node: NodeInfo, inPort: string, sig: RouteSig): RouteOut[] {
  const ports = node.ports;
  const inName = ports.in ? "in" : Object.keys(ports).find((p) => ports[p].direction === "in");
  const outName = ports.out ? "out" : Object.keys(ports).find((p) => ports[p].direction === "out");
  if (inPort === inName && outName) return [{ outPort: outName, amp: true }];
  return [
    {
      term: failTerm(
        "dead_end",
        "topology.direction_conflict",
        `${sig.id} arrives at ${node.id}.${inPort}; amplifiers only pass light ${inName ?? "in"} → ${outName ?? "out"}`,
        node.id,
        inPort,
      ),
    },
  ];
}

export interface AmpInput {
  channel: Channel;
  /** Per-channel worst-case input (includes upstream ripple spreads). */
  pin: Triple;
  /**
   * Aggregate-basis input (upstream amplifier flatness / measurement uncertainty NOT spread).
   * Used for Pin_total, saturation and every Σ-over-channels quantity. Defaults to `pin`.
   */
  pinAgg?: Triple;
}

export interface AmpCheck extends Check {
  port?: string;
}

export interface AmpComputation {
  mode: AmpMode;
  gainModel: "parametric" | "measured";
  pinTotal: Triple;
  /** Σ nominal per-channel output (before the ± flatness / uncertainty spread) per case. */
  poutTotal: Triple;
  /** Effective (post-clamp) gain setting per case. */
  gainEffective: Triple;
  /** Per input: gain applied in each case, incl. the ± spread (min gets −spread, max +spread). */
  gains: Triple[];
  /** pin + gains (per-channel worst case). */
  pouts: Triple[];
  /** pinAgg + nominal gains (no spread): the aggregate basis downstream. */
  poutsAgg: Triple[];
  headroom_dB: number;
  imbalanceIn_dB?: number;
  imbalanceOut_dB?: number;
  operatingPoints?: string;
  /** Channel-loading scenarios (SPEC 7.10 R2): step-3 gain change at full and single-channel load, typ case. */
  loading?: { designChannels: number; litChannels: number; full_dB: number; single_dB: number };
  checks: AmpCheck[];
  issues: Issue[];
  status: CheckStatus;
}

const CASES = ["min", "typ", "max"] as const;
type Case = (typeof CASES)[number];

interface MeasuredSel {
  valueAt(nm: number): number;
  extrapolated: boolean;
  desc: string;
}

function spectrumAt(p: GainSpectrumPoint, nm: number): number {
  const rows = [...p.spectrum].sort((a, b) => a.nm - b.nm);
  return interpXY(rows.map((r) => r.nm), rows.map((r) => r.gain_dB), nm);
}

/**
 * Measured model (SPEC 7.6 step 4): pick operating points whose gain_setting is nearest to G
 * (ties → all), interpolate linearly in input_power_total_dBm at the actual Pin_total (clamped),
 * and shift by (G − gain_setting_dB).
 */
function selectMeasured(points: GainSpectrumPoint[], G: number, pinTot: number): MeasuredSel {
  let best = Infinity;
  for (const p of points) best = Math.min(best, Math.abs(p.gain_setting_dB - G));
  const sel = points.filter((p) => Math.abs(p.gain_setting_dB - G) - best <= 1e-9);
  const groups = new Map<number, GainSpectrumPoint[]>();
  for (const p of sel) {
    const g = groups.get(p.input_power_total_dBm) ?? [];
    g.push(p);
    groups.set(p.input_power_total_dBm, g);
  }
  const xs = [...groups.keys()].sort((a, b) => a - b);
  const lo = xs[0];
  const hi = xs[xs.length - 1];
  const extrapolated = pinTot < lo - EPS || pinTot > hi + EPS;
  const groupVal = (x: number, nm: number) => {
    const g = groups.get(x)!;
    let s = 0;
    for (const p of g) s += spectrumAt(p, nm) + (G - p.gain_setting_dB);
    return s / g.length;
  };
  const settings = [...new Set(sel.map((p) => p.gain_setting_dB))].join("/");
  return {
    extrapolated,
    desc: `setting ${settings} dB @ Pin ${xs.join("/")} dBm`,
    valueAt(nm: number) {
      return interpXY(xs, xs.map((x) => groupVal(x, nm)), pinTot);
    },
  };
}

export interface AmpOptions {
  warnThreshold: number;
  maxImbalance: number;
  /** R4: lowest acceptable per-channel input, dBm (warn-only). */
  minChannelInput?: number;
  /** R2: full-load channel count; absent → no full-load scenario. */
  designChannels?: number;
}

/**
 * SPEC 7.6 step 3: effective gain for a total input `pt` — constant_output_power clamped to the
 * gain range, then the saturation clamp at Pout_max (either mode).
 */
function stepGain(model: AmplifierModel, s: NodeSettings, mode: AmpMode, pt: number): { g: number; saturated: boolean; clamped: boolean } {
  const poutMax = model.output_power_total_dBm.max;
  let g: number;
  let clamped = false;
  let saturated = false;
  if (mode === "constant_output_power") {
    g = (s.output_power_dBm ?? poutMax) - pt;
    if (g > model.gain_dB.max + EPS) {
      g = model.gain_dB.max;
      clamped = true;
    } else if (g < model.gain_dB.min - EPS) {
      g = model.gain_dB.min;
      clamped = true;
    }
  } else {
    g = s.gain_dB ?? model.gain_dB.min;
  }
  // Saturation: total output cannot exceed Pout_max.
  if (pt + g > poutMax + EPS) {
    g = poutMax - pt;
    saturated = true;
  }
  return { g, saturated, clamped };
}

/** R2 channel loading: N_lit distinct channels at `in`, scenarios at the typ Pin_total. */
function channelLoading(model: AmplifierModel, s: NodeSettings, mode: AmpMode, inputs: AmpInput[], pinTyp: number, designChannels?: number) {
  const lit = new Set(inputs.map((i) => `${i.channel.plan}:${i.channel.id}`)).size;
  if (designChannels === undefined || lit === 0) return undefined;
  const g0 = stepGain(model, s, mode, pinTyp).g;
  const full = designChannels > lit ? stepGain(model, s, mode, pinTyp + 10 * Math.log10(designChannels / lit)).g - g0 : 0;
  const single = lit > 1 ? stepGain(model, s, mode, pinTyp - 10 * Math.log10(lit)).g - g0 : 0;
  return { designChannels, litChannels: lit, full_dB: full, single_dB: single };
}

export function computeAmplifier(
  id: string,
  model: AmplifierModel,
  settings: NodeSettings | undefined,
  inputs: AmpInput[],
  opts: AmpOptions,
): AmpComputation {
  const s = settings ?? {};
  const mode: AmpMode = s.mode ?? model.modes[0];
  let gainModel: "parametric" | "measured" = s.gain_model ?? model.gain_model ?? "parametric";
  if (gainModel === "measured" && !(model.gain_spectrum && model.gain_spectrum.length)) gainModel = "parametric";
  const gmin = model.gain_dB.min;
  const gmax = model.gain_dB.max;
  const poutMax = model.output_power_total_dBm.max;
  const [b0, b1] = model.band_nm;
  const mid = (b0 + b1) / 2;
  const span = b1 - b0 || 1;
  const instTilt = (nm: number) => (s.tilt_dB ?? 0) * ((nm - mid) / span);
  const tiltRows = model.gain_tilt ? [...model.gain_tilt].sort((a, b) => a.nm - b.nm) : undefined;
  const tableTilt = (nm: number) => (tiltRows ? interpXY(tiltRows.map((r) => r.nm), tiltRows.map((r) => r.dB), nm) : 0);
  const spread = gainModel === "measured" ? model.measurement_uncertainty_dB ?? 0 : model.gain_flatness_dB ?? 0;

  const pinTot = {} as Record<Case, number>;
  const G = {} as Record<Case, number>;
  const gi = {} as Record<Case, number[]>;
  const poutTot = {} as Record<Case, number>;
  let saturated = false;
  let clamped = false;
  let extrapolated = false;
  let opDesc: string | undefined;

  const agg = inputs.map((i) => i.pinAgg ?? i.pin);
  for (const c of CASES) {
    const pins = agg.map((p) => p[c]);
    const pt = sumDbm(pins);
    pinTot[c] = pt;
    const st = stepGain(model, s, mode, pt);
    let g = st.g;
    if (st.saturated) saturated = true;
    if (st.clamped) clamped = true;
    // Per-channel nominal gain.
    let per: number[];
    if (gainModel === "measured") {
      const sel = selectMeasured(model.gain_spectrum!, g, pt);
      if (sel.extrapolated) extrapolated = true;
      if (c === "typ") opDesc = `${sel.desc}; Pin_total ${pt.toFixed(2)} dBm${sel.extrapolated ? " (clamped)" : ""}`;
      per = inputs.map((i) => sel.valueAt(i.channel.wavelength_nm) + instTilt(i.channel.wavelength_nm));
    } else {
      per = inputs.map((i) => g + tableTilt(i.channel.wavelength_nm) + instTilt(i.channel.wavelength_nm));
    }
    // Step 5: spectrum/tilt may push the total above Pout_max → re-clamp uniformly.
    const tot = sumDbm(agg.map((p, k) => p[c] + per[k]));
    if (tot > poutMax + EPS) {
      const shift = tot - poutMax;
      per = per.map((v) => v - shift);
      g -= shift;
      saturated = true;
    }
    G[c] = g;
    gi[c] = per;
    poutTot[c] = sumDbm(agg.map((p, k) => p[c] + per[k]));
  }

  const gains: Triple[] = inputs.map((_, k) => ({ min: gi.min[k] - spread, typ: gi.typ[k], max: gi.max[k] + spread }));
  const pouts: Triple[] = inputs.map((inp, k) => ({
    min: inp.pin.min + gains[k].min,
    typ: inp.pin.typ + gains[k].typ,
    max: inp.pin.max + gains[k].max,
  }));
  const poutsAgg: Triple[] = agg.map((p, k) => ({ min: p.min + gi.min[k], typ: p.typ + gi.typ[k], max: p.max + gi.max[k] }));
  const pinTotal: Triple = { min: pinTot.min, typ: pinTot.typ, max: pinTot.max };
  const poutTotal: Triple = { min: poutTot.min, typ: poutTot.typ, max: poutTot.max };
  const gainEffective: Triple = { min: G.min, typ: G.typ, max: G.max };

  const th = opts.warnThreshold;
  const checks: AmpCheck[] = [];
  const f2 = (v: number) => v.toFixed(2);

  const inLo = model.input_power_total_dBm.min;
  const inHi = model.input_power_total_dBm.max;
  const mLo = pinTotal.min - inLo;
  checks.push({
    code: "amp.input_low",
    port: "in",
    status: statusFromMargin(mLo, th),
    margin: mLo,
    values: { pin_total_min: pinTotal.min, input_min: inLo },
    message: `${id}: total input (min case) ${f2(pinTotal.min)} dBm vs minimum ${inLo} dBm`,
  });
  const mHi = inHi - pinTotal.max;
  checks.push({
    code: "amp.input_high",
    port: "in",
    status: statusFromMargin(mHi, th),
    margin: mHi,
    values: { pin_total_max: pinTotal.max, input_max: inHi },
    message: `${id}: total input (max case) ${f2(pinTotal.max)} dBm vs maximum ${inHi} dBm`,
  });
  const head = poutMax - poutTotal.max;
  checks.push({
    code: "amp.output_saturated",
    port: "out",
    status: saturated ? "warn" : statusFromMargin(head, th),
    margin: head,
    values: { pout_total_max: poutTotal.max, output_max: poutMax, gain_typ: G.typ },
    message: saturated
      ? `${id}: saturated — gain limited to ${f2(G.typ)} dB (typ) so total output stays at ${poutMax} dBm`
      : `${id}: total output ${f2(poutTotal.max)} dBm vs maximum ${poutMax} dBm`,
  });
  if (clamped) {
    checks.push({
      code: "amp.gain_clamped",
      status: "warn",
      values: { requested_output_dBm: s.output_power_dBm ?? poutMax, gain_typ: G.typ, gain_min: gmin, gain_max: gmax },
      message: `${id}: constant output power ${s.output_power_dBm} dBm needs gain outside ${gmin}…${gmax} dB; clamped to ${f2(G.typ)} dB (Pout_total ${f2(poutTotal.typ)} dBm)`,
    });
  }
  const gm = Math.min(...CASES.map((c) => Math.min(G[c] - gmin, gmax - G[c])));
  checks.push({
    code: "amp.gain_out_of_range",
    status: gm < -EPS ? "fail" : "pass",
    margin: gm,
    values: { gain_min_case: G.min, gain_typ: G.typ, gain_max_case: G.max, range_min: gmin, range_max: gmax },
    message: `${id}: effective gain ${f2(G.typ)} dB vs range ${gmin}…${gmax} dB`,
  });
  if (extrapolated) {
    checks.push({
      code: "amp.spectrum_extrapolated",
      status: "warn",
      values: { pin_total: pinTotal.typ },
      message: `${id}: Pin_total outside the measured gain-spectrum table; clamped to the nearest operating point`,
    });
  }
  const oob = inputs.filter((i) => i.channel.wavelength_nm < b0 - EPS || i.channel.wavelength_nm > b1 + EPS);
  for (const o of oob) {
    checks.push({
      code: "amp.out_of_band",
      status: "fail",
      values: { channel: o.channel.id, wavelength_nm: o.channel.wavelength_nm, band_min: b0, band_max: b1 },
      message: `${id}: ${o.channel.id} (${o.channel.wavelength_nm.toFixed(2)} nm) outside band ${b0}…${b1} nm; gain still applied`,
    });
  }
  if (opts.minChannelInput !== undefined) {
    const lim = opts.minChannelInput;
    for (const i of inputs) {
      const mg = i.pin.min - lim;
      if (mg >= -EPS) continue;
      checks.push({
        code: "amp.channel_input_low",
        port: "in",
        status: "warn",
        margin: mg,
        values: { channel: i.channel.id, pin_min: i.pin.min, limit_dBm: lim },
        message: `${id}: ${i.channel.id} input (min case) ${f2(i.pin.min)} dBm below ${lim} dBm; ASE noise dominates`,
      });
    }
  }
  let imbalanceIn_dB: number | undefined;
  let imbalanceOut_dB: number | undefined;
  if (inputs.length >= 2) {
    const tin = inputs.map((i) => i.pin.typ);
    const tout = pouts.map((p) => p.typ);
    imbalanceIn_dB = Math.max(...tin) - Math.min(...tin);
    imbalanceOut_dB = Math.max(...tout) - Math.min(...tout);
    for (const [port, v] of [["in", imbalanceIn_dB], ["out", imbalanceOut_dB]] as const) {
      const m = opts.maxImbalance - v;
      checks.push({
        code: "imbalance.high",
        port,
        status: statusFromMargin(m, th),
        margin: m,
        values: { imbalance_dB: v, limit_dB: opts.maxImbalance },
        message: `${id}.${port}: channel imbalance ${f2(v)} dB (typ) vs limit ${opts.maxImbalance} dB`,
      });
    }
  }

  const issues: Issue[] = [];
  for (const ck of checks) {
    if (ck.status !== "warn" && ck.status !== "fail") continue;
    const i: Issue = { severity: ck.status === "fail" ? "error" : "warn", code: ck.code, element: id, message: ck.message };
    if (ck.port) i.port = ck.port;
    if ((ck.code === "amp.out_of_band" || ck.code === "amp.channel_input_low") && ck.values) i.channel = String(ck.values.channel);
    if (ck.values) i.values = ck.margin !== undefined ? { ...ck.values, margin: ck.margin } : ck.values;
    issues.push(i);
  }

  return {
    mode,
    gainModel,
    pinTotal,
    poutTotal,
    gainEffective,
    gains,
    pouts,
    poutsAgg,
    headroom_dB: head,
    imbalanceIn_dB,
    imbalanceOut_dB,
    operatingPoints: opDesc,
    loading: channelLoading(model, s, mode, inputs, pinTotal.typ, opts.designChannels),
    checks,
    issues,
    status: worstOf(checks.map((c) => c.status)),
  };
}
