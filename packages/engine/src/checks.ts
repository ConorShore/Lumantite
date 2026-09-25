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

/** Total power penalty subtracted before the sensitivity comparison (SPEC 7.8 Rx power (low)). */
export function rxPenalty(m: ResolvedMargins, nConnectors: number): number {
  return m.system_margin_dB + m.ageing_dB + m.repair_splices * m.repair_splice_loss_dB + m.connector_ageing_dB * nConnectors;
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
): Check[] {
  const f2 = (v: number) => v.toFixed(2);
  const checks: Check[] = [];
  const penalty = rxPenalty(m, nConnectors);
  const low = power.min - penalty - rx.sensitivity_dBm;
  checks.push({
    code: "rx.power_low",
    status: statusFromMargin(low, warnThreshold),
    margin: low,
    values: { power_min: power.min, penalty_dB: penalty, sensitivity_dBm: rx.sensitivity_dBm, n_connectors: nConnectors },
    message: `Rx power (min) ${f2(power.min)} dBm − margins ${f2(penalty)} dB = ${f2(power.min - penalty)} dBm vs sensitivity ${rx.sensitivity_dBm} dBm`,
  });
  const high = rx.overload_dBm - power.max;
  checks.push({
    code: "rx.power_high",
    status: statusFromMargin(high, warnThreshold),
    margin: high,
    values: { power_max: power.max, overload_dBm: rx.overload_dBm },
    message: `Rx power (max) ${f2(power.max)} dBm vs overload ${rx.overload_dBm} dBm`,
  });
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
    const eff = cd * (1 + m.cd_margin_pct / 100);
    const mg = Math.min(eff - tmin, tmax - eff);
    checks.push({
      code: "rx.cd",
      status: mg < -EPS ? "fail" : "pass",
      margin: mg,
      values: { cd_ps_nm: cd, cd_with_margin: eff, cd_margin_pct: m.cd_margin_pct, tolerance_min: tmin, tolerance_max: tmax },
      message: `CD ${cd.toFixed(1)} ps/nm × ${(1 + m.cd_margin_pct / 100).toFixed(2)} = ${eff.toFixed(1)} ps/nm vs tolerance ${tmin}…${tmax} ps/nm`,
    });
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
