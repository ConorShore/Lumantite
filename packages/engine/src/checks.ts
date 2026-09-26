import {
  DEFAULT_MARGINS,
  type Check,
  type CheckStatus,
  type Issue,
  type Margins,
  type ResolvedMargins,
  type TransceiverModel,
  type Triple,
} from "@lumantite/schema";
import { EPS, statusFromMargin } from "./physics.js";

/** DEFAULT_MARGINS ← opts.defaultMargins ← project.margins, per key. */
export function resolveMargins(project?: Margins, defaults?: Margins): ResolvedMargins {
  const out: ResolvedMargins = { ...DEFAULT_MARGINS };
  for (const src of [defaults, project]) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) {
      if (v !== undefined && v !== null && k in out) (out as Record<string, number>)[k] = v as number;
    }
  }
  return out;
}

/** Total power penalty subtracted before the sensitivity comparison (SPEC 7.8 Rx power (low), 7.10 R19). */
export function rxPenalty(m: ResolvedMargins, nConnectors: number, pathKm = 0): number {
  return m.system_margin_dB + m.ageing_dB + m.repair_splices * m.repair_splice_loss_dB + m.connector_ageing_dB * nConnectors + m.repair_loss_dB_per_km * pathKm;
}

/** Signal properties beyond power / CD that the Rx checks use (SPEC 7.10). */
export interface RxExtra {
  /** Σ fibre length, km (R19). */
  pathKm?: number;
  /** ± CD uncertainty, ps/nm (R9). */
  cdSpread?: number;
  /** Power seen by the photodiode for overload / damage (R1: Σ of every signal at a direct-detect port). Default power.max. */
  powerHigh?: number;
  /** Mean DGD and its tolerance, ps (R15). */
  dgd?: number;
  dgdTolerance?: number;
  /** OSNR triple (R16); null = unknown (amplifier without NF). */
  osnr?: Triple | null;
}

/** Default DGD tolerance: explicit, else 0.1 × bit period for direct detect with a known baud (SPEC 7.10 R15). */
export function dgdTolerance(m: TransceiverModel): number | undefined {
  if (m.rx.dgd_tolerance_ps !== undefined) return m.rx.dgd_tolerance_ps;
  if ((m.detection ?? "direct") === "direct" && m.baud_GBd) return (0.1 * 1000) / m.baud_GBd;
  return undefined;
}

/** Receiver checks for a signal that reached an Rx port (SPEC 7.8). */
export function rxChecks(
  rx: TransceiverModel["rx"],
  power: Triple,
  cd: number,
  wavelength_nm: number,
  nConnectors: number,
  m: ResolvedMargins,
  warnThreshold: number,
  x: RxExtra = {},
): Check[] {
  const f2 = (v: number) => v.toFixed(2);
  const checks: Check[] = [];
  const pathKm = x.pathKm ?? 0;
  const penalty = rxPenalty(m, nConnectors, pathKm);
  const low = power.min - penalty - rx.sensitivity_dBm;
  checks.push({
    code: "rx.power_low",
    status: statusFromMargin(low, warnThreshold),
    margin: low,
    values: { power_min: power.min, penalty_dB: penalty, sensitivity_dBm: rx.sensitivity_dBm, n_connectors: nConnectors, path_km: pathKm },
    message: `Rx power (min) ${f2(power.min)} dBm − margins ${f2(penalty)} dB = ${f2(power.min - penalty)} dBm vs sensitivity ${rx.sensitivity_dBm} dBm`,
  });
  const pHigh = x.powerHigh ?? power.max;
  const agg = x.powerHigh !== undefined && Math.abs(x.powerHigh - power.max) > EPS;
  const what = agg ? "total at port (max)" : "(max)";
  const high = rx.overload_dBm - pHigh;
  const hc: Check = {
    code: "rx.power_high",
    status: statusFromMargin(high, warnThreshold),
    margin: high,
    values: { power_max: pHigh, overload_dBm: rx.overload_dBm },
    message: `Rx power ${what} ${f2(pHigh)} dBm vs overload ${rx.overload_dBm} dBm`,
  };
  if (hc.status === "fail") {
    // R5: attenuator that clears overload with the warn threshold, and the most the Rx-low margin allows.
    const sug = pHigh - rx.overload_dBm + warnThreshold;
    hc.values!.suggested_attenuation_dB = sug;
    hc.values!.max_attenuation_dB = low;
    hc.message +=
      low >= sug - EPS
        ? `; add a ${f2(sug)} dB attenuator (at most ${f2(low)} dB keeps sensitivity)`
        : `; needs ${f2(sug)} dB attenuation but only ${f2(low)} dB fits the sensitivity margin`;
  }
  checks.push(hc);
  if (rx.damage_dBm !== undefined) {
    const dm = rx.damage_dBm - pHigh;
    checks.push({
      code: "rx.power_damage",
      status: statusFromMargin(dm, warnThreshold),
      margin: dm,
      values: { power_max: pHigh, damage_dBm: rx.damage_dBm },
      message: `Rx power ${what} ${f2(pHigh)} dBm vs damage threshold ${rx.damage_dBm} dBm`,
    });
  }
  if (rx.wavelength_range_nm) {
    const [lo, hi] = rx.wavelength_range_nm;
    const mg = Math.min(wavelength_nm - lo, hi - wavelength_nm);
    checks.push({
      code: "rx.wavelength",
      status: mg < -EPS ? "fail" : "pass",
      margin: mg,
      values: { wavelength_nm, range_min: lo, range_max: hi },
      message: `λ ${wavelength_nm.toFixed(2)} nm vs receiver range ${lo}…${hi} nm`,
    });
  }
  if (rx.cd_tolerance_ps_nm !== undefined) {
    const tol = rx.cd_tolerance_ps_nm;
    const tmin = typeof tol === "number" ? -Math.abs(tol) : tol.min;
    const tmax = typeof tol === "number" ? Math.abs(tol) : tol.max;
    // R9: both extremes cd ± cd_spread, each × (1 + cd_margin).
    const k = 1 + m.cd_margin_pct / 100;
    const sp = x.cdSpread ?? 0;
    const lo = (cd - sp) * k;
    const hi = (cd + sp) * k;
    const mg = Math.min(lo - tmin, tmax - hi);
    const eff = lo - tmin < tmax - hi ? lo : hi; // the binding extreme
    const values: Record<string, number> = { cd_ps_nm: cd, cd_with_margin: eff, cd_margin_pct: m.cd_margin_pct, tolerance_min: tmin, tolerance_max: tmax };
    if (sp) values.cd_spread_ps_nm = sp;
    checks.push({
      code: "rx.cd",
      status: mg < -EPS ? "fail" : "pass",
      margin: mg,
      values,
      message: sp
        ? `CD (${cd.toFixed(1)} ± ${sp.toFixed(1)}) ps/nm × ${k.toFixed(2)} = ${lo.toFixed(1)}…${hi.toFixed(1)} ps/nm vs tolerance ${tmin}…${tmax} ps/nm`
        : `CD ${cd.toFixed(1)} ps/nm × ${k.toFixed(2)} = ${eff.toFixed(1)} ps/nm vs tolerance ${tmin}…${tmax} ps/nm`,
    });
  }
  if (x.dgd !== undefined && x.dgdTolerance !== undefined) {
    const mg = x.dgdTolerance - x.dgd;
    checks.push({
      code: "rx.pmd",
      status: statusFromMargin(mg, warnThreshold),
      margin: mg,
      values: { dgd_ps: x.dgd, tolerance_ps: x.dgdTolerance },
      message: `Mean DGD ${x.dgd.toFixed(2)} ps vs tolerance ${f2(x.dgdTolerance)} ps`,
    });
  }
  if (rx.min_osnr_dB !== undefined && x.osnr !== undefined) {
    if (x.osnr === null)
      checks.push({ code: "rx.osnr", status: "n/a", values: { min_osnr_dB: rx.min_osnr_dB }, message: `OSNR unknown: an amplifier on the path has no noise_figure_dB` });
    else {
      const mg = x.osnr.min - m.osnr_margin_dB - rx.min_osnr_dB;
      checks.push({
        code: "rx.osnr",
        status: statusFromMargin(mg, warnThreshold),
        margin: mg,
        values: { osnr_min_dB: x.osnr.min, osnr_typ_dB: x.osnr.typ, osnr_margin_dB: m.osnr_margin_dB, min_osnr_dB: rx.min_osnr_dB },
        message: `OSNR (min) ${f2(x.osnr.min)} dB − margin ${m.osnr_margin_dB} dB = ${f2(x.osnr.min - m.osnr_margin_dB)} dB vs required ${rx.min_osnr_dB} dB`,
      });
    }
  }
  return checks;
}

export function severityOf(status: CheckStatus): "error" | "warn" | undefined {
  return status === "fail" ? "error" : status === "warn" ? "warn" : undefined;
}

export function checkIssue(c: Check, element: string, extra: Partial<Issue> = {}): Issue | undefined {
  const sev = severityOf(c.status);
  if (!sev) return undefined;
  const i: Issue = { severity: sev, code: c.code, element, message: c.message, ...extra };
  const values = { ...(c.values ?? {}), ...(extra.values ?? {}) };
  if (c.margin !== undefined) values.margin = c.margin;
  if (Object.keys(values).length) i.values = values;
  return i;
}
