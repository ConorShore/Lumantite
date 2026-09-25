import type {
  AmplifierResult,
  Check,
  CheckStatus,
  FibreDirectionResult,
  FibreResult,
  Issue,
  Margins,
  PathStep,
  PortChannelResult,
  PortResult,
  ProjectModel,
  Results,
  SignalResult,
  Triple,
} from "@lumantite/schema";
import type { Catalog } from "./catalog.js";
import { checkIssue, resolveMargins, rxChecks } from "./checks.js";
import { buildGraph } from "./graph.js";
import { attenuationAt, scaleT, addT, statusFromMargin, subT, sumDbm, triple, worst, worstOf } from "./physics.js";
import { propagate, type TNode } from "./propagate.js";
import { validateSettings } from "./validate.js";
import { aggregateRules } from "./rules/aggregate.js";
import { staticRules } from "./rules/static.js";

export interface ComputeOptions {
  /** From app config; project.margins override per key; DEFAULT_MARGINS fill the rest. */
  defaultMargins?: Margins;
  /** Default 1.0: pass margin below this → "warn". */
  warnThreshold_dB?: number;
}

/** Launch power limit used when a fibre type has no max_power_dBm (decision log #5). */
export const DEFAULT_FIBRE_MAX_POWER_DBM = 20;
/** Reference wavelength for FibreResult.loss. */
export const FIBRE_LOSS_REFERENCE_NM = 1550;

/**
 * Aggregate (Σ over channels) power per case. Uses the aggregate-basis power of each channel when
 * known (amplifier ripple spreads excluded — they redistribute power between channels, they do not
 * raise a regulated amplifier's total), else the per-channel worst case.
 */
function totalOf(chs: PortChannelResult[], agg?: Map<PortChannelResult, Triple>): Triple | undefined {
  if (!chs.length) return undefined;
  const v = chs.map((c) => agg?.get(c) ?? c.power);
  return {
    min: sumDbm(v.map((p) => p.min)),
    typ: sumDbm(v.map((p) => p.typ)),
    max: sumDbm(v.map((p) => p.max)),
  };
}

const issueStatus = (i: Issue): CheckStatus => (i.severity === "error" ? "fail" : i.severity === "warn" ? "warn" : "n/a");

function emptyResults(issues: Issue[]): Results {
  return {
    computedAt: new Date().toISOString(),
    signals: [],
    ports: [],
    fibres: [],
    amplifiers: [],
    issues,
    elementStatus: {},
    summary: {
      signals: 0,
      pass: 0,
      warn: 0,
      fail: 0,
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warn").length,
    },
  };
}

/** Full computation (SPEC §7). Never throws on bad input: returns issues instead. */
export function compute(model: ProjectModel, catalog: Catalog, opts: ComputeOptions = {}): Results {
  const issues: Issue[] = [];
  try {
    return computeInner(model, catalog, opts, issues);
  } catch (e) {
    issues.push({
      severity: "error",
      code: "project.invalid_settings",
      element: model?.rootFile,
      message: `Computation aborted: ${e instanceof Error ? e.message : String(e)}`,
    });
    return emptyResults(issues);
  }
}

function computeInner(model: ProjectModel, catalog: Catalog, opts: ComputeOptions, issues: Issue[]): Results {
  const margins = resolveMargins(model.project?.margins, opts.defaultMargins);
  const th = opts.warnThreshold_dB ?? 1.0;
  const { graph, issues: gIssues } = buildGraph(model, catalog);
  issues.push(...gIssues, ...validateSettings(model, graph, catalog), ...staticRules(graph, catalog, margins));

  const prop = propagate(graph, catalog, issues, { warnThreshold: th, maxImbalance: margins.max_channel_imbalance_dB });
  const { signals } = prop;

  // ---------------- signals
  const signalResults: SignalResult[] = [];
  const rxHit = new Set<string>();
  const toStep = (n: TNode): PathStep => {
    const s: PathStep = {
      element: n.element,
      kind: n.kind,
      deltaPower: n.parent ? subT(n.after!, n.before!) : triple(0),
      deltaCd: n.cd,
      power: n.after!,
      cd: n.cdAfter,
    };
    if (n.inPort !== undefined) s.inPort = n.inPort;
    if (n.outPort !== undefined) s.outPort = n.outPort;
    if (n.note !== undefined) s.note = n.note;
    return s;
  };
  for (const leaf of prop.leaves) {
    const sig = signals[leaf.tree];
    const last = leaf.path[leaf.path.length - 1];
    const power = last.after!;
    const cd = last.cdAfter;
    let checks: Check[] = [];
    const term = leaf.term;
    const res: SignalResult = {
      id: leaf.id,
      tx: { node: sig.txNode, port: sig.txPort },
      channel: sig.channel,
      launch: sig.launch,
      path: leaf.path.map(toStep),
      powerAtEnd: power,
      cdAtEnd: cd,
      cdSpread: 0,
      path_km: leaf.path.reduce((k, n) => k + (n.kind === "fibre" ? graph.fibres.get(n.element)?.length_km ?? 0 : 0), 0),
      terminated: term.kind,
      checks,
      status: "n/a",
    };
    if (term.kind === "rx" && term.rx) {
      res.rx = term.rx;
      rxHit.add(`${term.rx.node}.${term.rx.port}`);
      const rxNode = graph.nodes.get(term.rx.node)!;
      const m = rxNode.model;
      if (m?.kind === "transceiver") {
        const nConn = leaf.path.reduce((k, n) => k + (n.kind === "joint" && n.connector ? 1 : 0), 0);
        checks = rxChecks(m.rx, power, cd, sig.channel.wavelength_nm, nConn, margins, th);
        for (const c of checks) {
          const i = checkIssue(c, term.rx.node, { port: term.rx.port, channel: sig.channel.id, values: { signal: leaf.id } });
          if (i) issues.push(i);
        }
      }
    } else if (term.check) {
      checks = [term.check];
      if (!term.silent) {
        const i = checkIssue(term.check, term.element ?? sig.txNode, { channel: sig.channel.id, values: { signal: leaf.id } });
        if (i) {
          if (term.port) i.port = term.port;
          issues.push(i);
        }
      }
    }
    res.checks = checks;
    res.status = worstOf(checks.map((c) => c.status));
    signalResults.push(res);
  }

  // ---------------- per-port and per-fibre records
  const portMap = new Map<string, PortResult>();
  const portOf = (node: string, port: string): PortResult => {
    const k = `${node}.${port}`;
    let p = portMap.get(k);
    if (!p) {
      p = { node, port, out: { channels: [] }, in: { channels: [] }, status: "n/a" };
      portMap.set(k, p);
    }
    return p;
  };
  const fibreDirs = new Map<string, { chs: PortChannelResult[]; freq: Map<string, string> }>();
  const seenRec = new Set<string>();
  const aggOf = new Map<PortChannelResult, Triple>();
  for (const n of prop.evaluated) {
    const sig = signals[n.tree];
    const sid = n.sid ?? sig.id;
    if (n.recIn && n.inPort !== undefined) {
      const k = `${n.tree}|${n.element}.${n.inPort}|in`;
      if (!seenRec.has(k)) {
        seenRec.add(k);
        const rec: PortChannelResult = { signalId: sid, channel: sig.channel, power: n.before!, cd: n.parent!.cdAfter };
        portOf(n.element, n.inPort).in.channels.push(rec);
        aggOf.set(rec, n.parent!.agg!);
      }
    }
    if (n.recOut && n.outPort !== undefined) {
      const k = `${n.tree}|${n.element}.${n.outPort}|out`;
      if (!seenRec.has(k)) {
        seenRec.add(k);
        const rec: PortChannelResult = { signalId: sid, channel: sig.channel, power: n.after!, cd: n.cdAfter };
        portOf(n.element, n.outPort).out.channels.push(rec);
        aggOf.set(rec, n.agg!);
      }
    }
    if (n.fibreDir) {
      const upstream = n.launchFromParent && n.parent?.parent ? n.parent.parent : n.parent!;
      const launch = upstream.after!;
      const cd0 = n.parent!.cdAfter;
      const k = `${n.element}|${n.fibreDir}`;
      let d = fibreDirs.get(k);
      if (!d) {
        d = { chs: [], freq: new Map() };
        fibreDirs.set(k, d);
      }
      const rec: PortChannelResult = { signalId: sid, channel: sig.channel, power: launch, cd: cd0 };
      d.chs.push(rec);
      aggOf.set(rec, upstream.agg!);
      const fk = sig.channel.frequency_GHz.toFixed(1);
      const prev = d.freq.get(fk);
      if (prev !== undefined) {
        issues.push({
          severity: "error",
          code: "topology.duplicate_channel",
          element: n.element,
          channel: sig.channel.id,
          message: `${n.element} (${n.fibreDir}): channel ${sig.channel.id} carried twice (${prev}, ${sid})`,
          values: { direction: n.fibreDir, signals: `${prev}, ${sid}` },
        });
      } else d.freq.set(fk, sid);
    }
  }
  // connected ports without traffic
  for (const key of graph.portLinks.keys()) {
    const i = key.indexOf(".");
    portOf(key.slice(0, i), key.slice(i + 1));
  }
  for (const p of portMap.values()) {
    const ti = totalOf(p.in.channels, aggOf);
    const to = totalOf(p.out.channels, aggOf);
    if (ti) p.in.totalPower = ti;
    if (to) p.out.totalPower = to;
  }

  // ---------------- mux channel imbalance at common
  for (const n of graph.nodes.values()) {
    if (n.model?.kind !== "mux") continue;
    const p = portMap.get(`${n.id}.common`);
    if (!p) continue;
    for (const dir of ["out", "in"] as const) {
      const chs = p[dir].channels;
      if (chs.length < 2) continue;
      const typ = chs.map((c) => c.power.typ);
      const imb = Math.max(...typ) - Math.min(...typ);
      const lim = margins.max_channel_imbalance_dB;
      const st = statusFromMargin(lim - imb, th);
      const i = checkIssue(
        {
          code: "imbalance.high",
          status: st,
          margin: lim - imb,
          values: { direction: dir, imbalance_dB: imb, limit_dB: lim, channels: chs.length },
          message: `${n.id}.common (${dir === "out" ? "combined" : "arriving"}): channel imbalance ${imb.toFixed(2)} dB (typ) vs limit ${lim} dB`,
        },
        n.id,
        { port: "common" },
      );
      if (i) issues.push(i);
    }
  }

  // ---------------- rx without signal
  for (const n of graph.nodes.values()) {
    if (n.model?.kind !== "transceiver" || !n.rxPort) continue;
    const key = `${n.id}.${n.rxPort}`;
    if (rxHit.has(key)) continue;
    const connected = graph.portLinks.has(key);
    issues.push({
      severity: "warn",
      code: "topology.rx_no_signal",
      element: n.id,
      port: n.rxPort,
      message: connected ? `${key}: no signal arrives at this receiver` : `${key}: receiver is not connected`,
    });
  }

  // ---------------- fibres
  const fibreResults: FibreResult[] = [];
  for (const f of graph.fibres.values()) {
    const loss = f.type
      ? addT(scaleT(f.inst.attenuation_dB_per_km !== undefined ? triple(f.inst.attenuation_dB_per_km) : attenuationAt(f.type, FIBRE_LOSS_REFERENCE_NM), f.length_km), triple(f.inst.extra_loss_dB ?? 0))
      : triple(0);
    const maxP = f.type?.max_power_dBm ?? DEFAULT_FIBRE_MAX_POWER_DBM;
    const directions: FibreDirectionResult[] = [];
    for (const dir of ["a>b", "b>a"] as const) {
      const d = fibreDirs.get(`${f.id}|${dir}`);
      if (!d) continue;
      const total = totalOf(d.chs, aggOf)!;
      const mg = maxP - total.max;
      let st = statusFromMargin(mg, th);
      const i = checkIssue(
        {
          code: "fibre.power_high",
          status: st,
          margin: mg,
          values: { direction: dir, total_max_dBm: total.max, total_typ_dBm: total.typ, limit_dBm: maxP, channels: d.chs.length },
          message: `${f.id} (${dir}): aggregate launch power ${total.max.toFixed(2)} dBm (max case; typ ${total.typ.toFixed(2)}) vs limit ${maxP} dBm`,
        },
        f.id,
        { port: dir === "a>b" ? "a" : "b" },
      );
      if (i) issues.push(i);
      if (d.chs.length !== d.freq.size) st = worst(st, "fail");
      directions.push({ direction: dir, channels: d.chs, totalPower: total, status: st });
    }
    fibreResults.push({ id: f.id, length_km: f.length_km, loss, directions, status: worstOf(directions.map((d) => d.status)) });
  }

  // ---------------- amplifiers
  const ampResults: AmplifierResult[] = prop.amps.map((a) => {
    const r: AmplifierResult = {
      id: a.id,
      mode: a.comp.mode,
      gainModel: a.comp.gainModel,
      pinTotal: a.comp.pinTotal,
      poutTotal: a.comp.poutTotal,
      gainEffective: a.comp.gainEffective,
      headroom_dB: a.comp.headroom_dB,
      perChannel: a.nodes.map((n, k) => ({
        signalId: n.sid ?? signals[n.tree].id,
        channel: signals[n.tree].channel,
        gain: a.comp.gains[k],
        pin: n.before!,
        pout: n.after!,
      })),
      status: a.comp.status,
    };
    if (a.comp.imbalanceIn_dB !== undefined) r.imbalanceIn_dB = a.comp.imbalanceIn_dB;
    if (a.comp.imbalanceOut_dB !== undefined) r.imbalanceOut_dB = a.comp.imbalanceOut_dB;
    if (a.comp.operatingPoints !== undefined) r.operatingPoints = a.comp.operatingPoints;
    return r;
  });

  // ---------------- design rules on computed results (SPEC 7.10)
  issues.push(
    ...aggregateRules({ graph, catalog, margins, warnThreshold: th, signals: signalResults, ports: [...portMap.values()], fibres: fibreResults, amplifiers: ampResults }),
  );

  // ---------------- statuses
  const elementStatus: Record<string, CheckStatus> = {};
  for (const id of graph.nodes.keys()) elementStatus[id] = "n/a";
  for (const id of graph.fibres.keys()) elementStatus[id] = "n/a";
  for (const p of portMap.values()) {
    if (p.in.channels.length || p.out.channels.length) {
      p.status = "pass";
      elementStatus[p.node] = worst(elementStatus[p.node] ?? "n/a", "pass");
    }
  }
  for (const f of fibreResults) if (f.directions.length) elementStatus[f.id] = worst(elementStatus[f.id], f.status === "n/a" ? "pass" : f.status);
  for (const a of ampResults) elementStatus[a.id] = worst(elementStatus[a.id] ?? "n/a", a.status);
  for (const i of issues) {
    const st = issueStatus(i);
    if (st === "n/a" || !i.element) continue;
    if (i.element in elementStatus) elementStatus[i.element] = worst(elementStatus[i.element], st);
    if (i.port !== undefined && graph.nodes.has(i.element)) {
      const p = portMap.get(`${i.element}.${i.port}`);
      if (p) p.status = worst(p.status, st);
    }
  }
  const fibreById = new Map(fibreResults.map((f) => [f.id, f]));
  for (const i of issues) {
    const f = i.element !== undefined ? fibreById.get(i.element) : undefined;
    if (f) f.status = worst(f.status, issueStatus(i));
  }

  // ---------------- ports, ordered by node then port declaration
  const byNode = new Map<string, PortResult[]>();
  for (const p of portMap.values()) {
    const l = byNode.get(p.node) ?? [];
    l.push(p);
    byNode.set(p.node, l);
  }
  const ports: PortResult[] = [];
  for (const n of graph.nodes.values()) {
    const l = byNode.get(n.id);
    if (!l) continue;
    const order = Object.keys(n.ports);
    const rank = (p: PortResult) => {
      const i = order.indexOf(p.port);
      return i < 0 ? order.length : i;
    };
    l.sort((a, b) => rank(a) - rank(b));
    ports.push(...l);
  }

  const summary = {
    signals: signalResults.length,
    pass: signalResults.filter((s) => s.status === "pass").length,
    warn: signalResults.filter((s) => s.status === "warn").length,
    fail: signalResults.filter((s) => s.status === "fail").length,
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warn").length,
  };
  return {
    computedAt: new Date().toISOString(),
    signals: signalResults,
    ports,
    fibres: fibreResults,
    amplifiers: ampResults,
    issues,
    elementStatus,
    summary,
  };
}
