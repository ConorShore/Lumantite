import type {
  AmplifierResult,
  Channel,
  FibreModel,
  FibreResult,
  Issue,
  LaserClass,
  PortChannelResult,
  PortResult,
  ResolvedMargins,
  SignalResult,
  TransceiverModel,
} from "@lumantite/schema";
import type { Catalog } from "../catalog.js";
import { checkIssue } from "../checks.js";
import type { FibreInfo, Graph } from "../graph.js";
import { EPS, dispersionAt, dbmToMw, mwToDbm, statusFromMargin } from "../physics.js";
import { isApc, isMultimode, normStandard } from "./static.js";

export interface AggregateCtx {
  graph: Graph;
  catalog: Catalog;
  margins: ResolvedMargins;
  warnThreshold: number;
  signals: SignalResult[];
  ports: PortResult[];
  fibres: FibreResult[];
  amplifiers: AmplifierResult[];
}

/** Per-channel launch limit when the fibre type has none (SPEC 7.10 R3). */
export const DEFAULT_MAX_CHANNEL_POWER_DBM = 4;
/** Fibres shorter than this are patch cords for R3 / R8 / R9 / R18. */
export const RULE_MIN_FIBRE_KM = 1;
/** R6: total launch above which a non-APC connector is a reflection risk. */
export const REFLECTION_POWER_DBM = 17;
/** R8: |D| below this enables four-wave mixing. */
export const FWM_MAX_ABS_D = 1.0;
/** R8: water-peak band. */
export const WATER_PEAK_NM: [number, number] = [1360, 1460];
/** R13: indicative IEC 60825-2 limits for λ ≥ 1400 nm (IRB); IRA (λ < 1400 nm) 3 dB lower. */
export const LASER_CLASS_LIMITS: [LaserClass, number][] = [["1", 10], ["3R", 17], ["3B", 27]];
export const IRA_OFFSET_DB = -3;
/** R18: direct-detect within this of a coherent channel. */
export const XPM_MAX_DELTA_GHZ = 100;

const f2 = (v: number) => v.toFixed(2);
const WATER_PEAK_STANDARDS = new Set(["G.652", "G.652.A", "G.652.B"]);
const txNodeOf = (signalId: string) => signalId.slice(0, signalId.indexOf("."));

export function laserClass(total_dBm: number, minNm: number): LaserClass {
  const off = minNm < 1400 ? IRA_OFFSET_DB : 0;
  for (const [c, lim] of LASER_CLASS_LIMITS) if (total_dBm <= lim + off + EPS) return c;
  return "4";
}

export function lowWaterPeak(t: FibreModel): boolean {
  if (t.low_water_peak !== undefined) return t.low_water_peak;
  return !(t.standard !== undefined && WATER_PEAK_STANDARDS.has(normStandard(t.standard)));
}

/** Transceiver fibre mode (SPEC 5.1): explicit, else mmf below 1000 nm. */
function fibreMode(m: TransceiverModel, catalog: Catalog, txNm?: number): "smf" | "mmf" {
  if (m.fibre_mode) return m.fibre_mode;
  const w = m.tx.wavelength;
  const nm = txNm ?? ("wavelength_nm" in w ? w.wavelength_nm : catalog.channels(w.plan)[0]?.wavelength_nm);
  return nm !== undefined && nm < 1000 ? "mmf" : "smf";
}

function fibreD(f: FibreInfo, nm: number): number | undefined {
  if (f.inst.dispersion_ps_nm_km !== undefined) return f.inst.dispersion_ps_nm_km;
  if (!f.type || f.type.dispersion.model === "none") return undefined;
  return dispersionAt(f.type, nm);
}

/** Grid axis of a plan for R17: CWDM plans are defined in nm, DWDM in GHz. Spacing = smallest step. */
const gridCache = new WeakMap<object, { nm: boolean; spacing: number }>();
function gridOf(catalog: Catalog, plan: string): { nm: boolean; spacing: number } | undefined {
  const p = catalog.plans.get(plan);
  if (!p) return undefined;
  let g = gridCache.get(p);
  if (!g) {
    const nm = p.channels.every((c) => c.frequency_GHz === undefined);
    const xs = catalog.channels(plan).map((c) => (nm ? c.wavelength_nm : c.frequency_GHz)).sort((a, b) => a - b);
    let sp = Infinity;
    for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > EPS) sp = Math.min(sp, xs[i] - xs[i - 1]);
    g = { nm, spacing: sp };
    gridCache.set(p, g);
  }
  return Number.isFinite(g.spacing) ? g : undefined;
}

/**
 * Design rules evaluated on computed results (SPEC 7.10): R3 per-channel launch, R6 reflection
 * risk, R7 path mode mismatch, R8 FWM / water peak, R9 DCM matching, R13 laser class,
 * R17 crosstalk, R18 XPM. May set result fields (e.g. FibreDirectionResult.laserClass) in place.
 * Returned issues are added before element statuses are derived.
 */
export function aggregateRules(ctx: AggregateCtx): Issue[] {
  const { graph, catalog, margins, warnThreshold: th } = ctx;
  const out: Issue[] = [];
  const seen = new Set<string>();
  const once = (key: string, i: Issue | undefined) => {
    if (!i || seen.has(key)) return;
    seen.add(key);
    out.push(i);
  };
  const detection = new Map<string, "direct" | "coherent" | undefined>();
  const detOf = (signalId: string) => {
    const node = txNodeOf(signalId);
    if (!detection.has(node)) {
      const m = graph.nodes.get(node)?.model;
      detection.set(node, m?.kind === "transceiver" ? m.detection ?? "direct" : undefined);
    }
    return detection.get(node);
  };
  const anyCoherent = [...graph.nodes.values()].some((n) => n.model?.kind === "transceiver" && n.model.detection === "coherent");

  // ---------------- per-signal path rules: R7 (path mode), R9 (DCM), R18 (amplified fibres)
  const amplified = new Set<string>();
  for (const s of ctx.signals) {
    const txm = graph.nodes.get(s.tx.node)?.model;
    const ends: [string, "smf" | "mmf"][] = [];
    if (txm?.kind === "transceiver") ends.push([s.tx.node, fibreMode(txm, catalog, s.channel.wavelength_nm)]);
    const rxm = s.rx ? graph.nodes.get(s.rx.node)?.model : undefined;
    if (s.rx && rxm?.kind === "transceiver") ends.push([s.rx.node, fibreMode(rxm, catalog)]);
    let sinceDcm: FibreInfo[] = [];
    let amped = false;
    for (const st of s.path) {
      if (st.kind === "amplifier") amped = true;
      if (st.kind === "fibre") {
        const f = graph.fibres.get(st.element);
        if (!f?.type) continue;
        if (amped && anyCoherent) amplified.add(`${f.id}|${st.inPort === "a" ? "a>b" : "b>a"}`);
        if (f.length_km >= RULE_MIN_FIBRE_KM - EPS) sinceDcm.push(f);
        const mm = isMultimode(f.type);
        for (const [node, mode] of ends) {
          if ((mode === "mmf") === mm) continue;
          once(`R7|${f.id}`, {
            severity: "error",
            code: "fibre.mode_mismatch",
            element: f.id,
            channel: s.channel.id,
            message: `${f.id}: ${mm ? "multimode" : "single-mode"} fibre ${f.type.id} on the path of ${s.id}; ${node} is built for ${mode === "mmf" ? "multimode" : "single-mode"} fibre`,
            values: { transceiver: node, fibre_mode: mode, fibre_type: f.type.id, signal: s.id },
          });
        }
        continue;
      }
      if (st.kind !== "dcm") continue;
      const dm = graph.nodes.get(st.element)?.model;
      const want = dm?.kind === "dcm" ? dm.for_fibre : undefined;
      if (want !== undefined) {
        for (const f of sinceDcm) {
          if (f.type!.id === want || (f.type!.standard !== undefined && normStandard(f.type!.standard) === normStandard(want))) continue;
          once(`R9|${st.element}|${f.id}`, {
            severity: "warn",
            code: "dcm.fibre_mismatch",
            element: st.element,
            message: `${st.element}: DCM matched to ${want} compensates ${f.id} (${f.type!.standard ?? f.type!.id}); slope mismatch leaves residual CD across the band`,
            values: { for_fibre: want, fibre: f.id, fibre_type: f.type!.id, fibre_standard: f.type!.standard ?? "" },
          });
        }
      }
      sinceDcm = [];
    }
  }

  // ---------------- per fibre direction: R3, R6 reflection, R8, R13, R18
  for (const fr of ctx.fibres) {
    const f = graph.fibres.get(fr.id);
    const t = f?.type;
    if (!f || !t) continue;
    const long = fr.length_km >= RULE_MIN_FIBRE_KM - EPS;
    const maxCh = t.max_channel_power_dBm ?? DEFAULT_MAX_CHANNEL_POWER_DBM;
    for (const d of fr.directions) {
      const port = d.direction === "a>b" ? "a" : "b";
      const at = { port, values: { direction: d.direction } };
      const chs = d.channels;
      // R13 laser class
      if (d.totalPower && chs.length) {
        const minNm = Math.min(...chs.map((c) => c.channel.wavelength_nm));
        const cls = laserClass(d.totalPower.max, minNm);
        d.laserClass = cls;
        if (cls !== "1")
          once(`R13|${fr.id}|${d.direction}`, {
            severity: "info",
            code: "safety.laser_class",
            element: fr.id,
            port,
            message: `${fr.id} (${d.direction}): ${f2(d.totalPower.max)} dBm total (max case) → indicative hazard class ${cls}${minNm < 1400 ? " (λ < 1400 nm limits)" : ""}; automatic power reduction / shutdown required`,
            values: { direction: d.direction, total_max_dBm: d.totalPower.max, laser_class: cls, min_wavelength_nm: minNm },
          });
      }
      // R6 reflection risk
      if (d.totalPower && d.totalPower.max > REFLECTION_POWER_DBM + EPS) {
        for (const e of ["a", "b"] as const) {
          const j = f.ends[e].joint;
          const pol = j?.connector ? catalog.models.get(j.id) : undefined;
          if (pol?.kind !== "joint" || !pol.polish || isApc(pol.polish)) continue;
          once(`R6|${fr.id}|${e}`, {
            severity: "warn",
            code: "joint.reflection_risk",
            element: fr.id,
            port: e,
            message: `${fr.id}.${e}: ${f2(d.totalPower.max)} dBm (max case, ${d.direction}) through ${pol.polish} connector ${pol.id}; use APC above ${REFLECTION_POWER_DBM} dBm (back-reflection, unplugged-connector hazard)`,
            values: { direction: d.direction, total_max_dBm: d.totalPower.max, joint: pol.id, polish: pol.polish, limit_dBm: REFLECTION_POWER_DBM },
          });
        }
      }
      if (!long) continue;
      // R3 per-channel launch (warn-only)
      for (const c of chs) {
        const mg = maxCh - c.power.max;
        if (mg >= -EPS) continue;
        once(
          `R3|${fr.id}|${d.direction}|${c.channel.id}`,
          checkIssue(
            {
              code: "fibre.channel_power_high",
              status: "warn",
              margin: mg,
              values: { ...at.values, power_max_dBm: c.power.max, limit_dBm: maxCh, signal: c.signalId },
              message: `${fr.id} (${d.direction}): ${c.channel.id} launched at ${f2(c.power.max)} dBm (max case) vs ${maxCh} dBm per channel (nonlinear threshold)`,
            },
            fr.id,
            { port, channel: c.channel.id },
          ),
        );
      }
      // R8 four-wave mixing
      const distinct = new Map<string, Channel>();
      for (const c of chs) distinct.set(c.channel.frequency_GHz.toFixed(1), c.channel);
      if (distinct.size >= 2) {
        let lowest: { ch: Channel; D: number } | undefined;
        for (const ch of distinct.values()) {
          const D = fibreD(f, ch.wavelength_nm);
          if (D !== undefined && (!lowest || Math.abs(D) < Math.abs(lowest.D))) lowest = { ch, D };
        }
        if (lowest && Math.abs(lowest.D) < FWM_MAX_ABS_D - EPS)
          once(
            `R8f|${fr.id}|${d.direction}`,
            checkIssue(
              {
                code: "fibre.fwm_risk",
                status: "warn",
                margin: Math.abs(lowest.D) - FWM_MAX_ABS_D,
                values: { ...at.values, dispersion_ps_nm_km: lowest.D, channels: distinct.size, limit: FWM_MAX_ABS_D },
                message: `${fr.id} (${d.direction}): ${distinct.size} channels on ${t.standard ?? t.id} with |D| = ${Math.abs(lowest.D).toFixed(3)} ps/(nm·km) at ${lowest.ch.id} < ${FWM_MAX_ABS_D}; four-wave mixing risk`,
              },
              fr.id,
              { port, channel: lowest.ch.id },
            ),
          );
      }
      // R18 XPM: direct-detect within 100 GHz of coherent on an amplified span
      if (amplified.has(`${fr.id}|${d.direction}`)) {
        const coh = chs.filter((c) => detOf(c.signalId) === "coherent");
        let hit: [PortChannelResult, PortChannelResult] | undefined;
        for (const c of chs) {
          if (detOf(c.signalId) !== "direct") continue;
          const n = coh.find((k) => Math.abs(k.channel.frequency_GHz - c.channel.frequency_GHz) <= XPM_MAX_DELTA_GHZ + 1e-6);
          if (n) {
            hit = [c, n];
            break;
          }
        }
        if (hit) {
          const df = Math.abs(hit[0].channel.frequency_GHz - hit[1].channel.frequency_GHz);
          once(`R18|${fr.id}|${d.direction}`, {
            severity: "warn",
            code: "fibre.xpm_risk",
            element: fr.id,
            port,
            channel: hit[0].channel.id,
            message: `${fr.id} (${d.direction}): direct-detect ${hit[0].channel.id} ${df.toFixed(0)} GHz from coherent ${hit[1].channel.id} on an amplified span; cross-phase modulation risk`,
            values: { direction: d.direction, direct: hit[0].signalId, coherent: hit[1].signalId, delta_GHz: df },
          });
        }
      }
    }
    // R8 water peak: any direction, any length
    if (!lowWaterPeak(t)) {
      for (const d of fr.directions)
        for (const c of d.channels) {
          const nm = c.channel.wavelength_nm;
          if (nm < WATER_PEAK_NM[0] || nm > WATER_PEAK_NM[1]) continue;
          once(`R8w|${fr.id}|${c.channel.id}`, {
            severity: "warn",
            code: "fibre.water_peak",
            element: fr.id,
            channel: c.channel.id,
            message: `${fr.id}: ${c.channel.id} (${nm.toFixed(1)} nm) in the water-peak band on ${t.standard ?? t.id}, which is not low-water-peak`,
            values: { wavelength_nm: nm, fibre_type: t.id, standard: t.standard ?? "" },
          });
        }
    }
  }

  // ---------------- R17 adjacent-channel crosstalk at demux channel ports
  const portIdx = new Map<string, PortResult>();
  for (const p of ctx.ports) portIdx.set(`${p.node}.${p.port}`, p);
  for (const n of graph.nodes.values()) {
    const m = n.model;
    if (m?.kind !== "mux" || m.isolation_dB === undefined) continue;
    const common = portIdx.get(`${n.id}.common`);
    const inC = common?.in.channels ?? [];
    if (inC.length < 2) continue;
    const grid = gridOf(catalog, m.plan);
    if (!grid) continue;
    const x = (c: Channel) => (grid.nm ? c.wavelength_nm : c.frequency_GHz);
    const reach = 1.5 * grid.spacing + 1e-6;
    const tol = grid.spacing / 4;
    // leaving channel ports, by signal
    const outOf = new Map<string, { port: string; rec: PortChannelResult }>();
    for (const [pn, spec] of Object.entries(n.ports)) {
      if (!spec.channel) continue;
      for (const rec of portIdx.get(`${n.id}.${pn}`)?.out.channels ?? []) outOf.set(rec.signalId, { port: pn, rec });
    }
    for (const cIn of inC) {
      const o = outOf.get(cIn.signalId);
      if (!o || detOf(cIn.signalId) === "coherent") continue;
      const xc = x(cIn.channel);
      // nearest occupied slot on each side
      let lo = -Infinity;
      let hi = Infinity;
      for (const k of inC) {
        const dx = x(k.channel) - xc;
        if (Math.abs(dx) <= tol || Math.abs(dx) > reach) continue;
        if (dx < 0) lo = Math.max(lo, dx);
        else hi = Math.min(hi, dx);
      }
      const ilC = cIn.power.max - o.rec.power.max;
      const xt: number[] = [];
      const ids: string[] = [];
      for (const k of inC) {
        const dx = x(k.channel) - xc;
        if (Math.abs(dx - lo) > tol && Math.abs(dx - hi) > tol) continue;
        const ko = outOf.get(k.signalId);
        const il = ko ? k.power.max - ko.rec.power.max : ilC;
        xt.push(k.power.max - il - m.isolation_dB);
        ids.push(k.channel.id);
      }
      if (!xt.length) continue;
      const crosstalk = mwToDbm(xt.reduce((a, v) => a + dbmToMw(v), 0));
      const signal = o.rec.power.min;
      const ratio = signal - crosstalk;
      const lim = margins.min_crosstalk_ratio_dB;
      const mg = ratio - lim;
      once(
        `R17|${n.id}|${o.port}|${cIn.channel.id}`,
        checkIssue(
          {
            code: "mux.crosstalk",
            status: statusFromMargin(mg, th),
            margin: mg,
            values: { signal_dBm: signal, crosstalk_dBm: crosstalk, ratio_dB: ratio, limit_dB: lim, isolation_dB: m.isolation_dB, neighbours: ids.join(", "), signal: cIn.signalId },
            message: `${n.id}.${o.port}: ${cIn.channel.id} ${f2(signal)} dBm (min) vs adjacent-channel crosstalk ${f2(crosstalk)} dBm from ${ids.join(", ")} → ratio ${f2(ratio)} dB vs ${lim} dB`,
          },
          n.id,
          { port: o.port, channel: cIn.channel.id },
        ),
      );
    }
  }

  return out;
}
