import type { Channel, Issue, Triple, WlSpec } from "@lumantite/schema";
import { txChannel, type Catalog } from "./catalog.js";
import { computeAmplifier, route, type AmpComputation, type RouteCtx, type RouteSig, type Term } from "./devices/index.js";
import { junctionName, other, portJointName, type End, type FibreInfo, type Graph, type JointRef } from "./graph.js";
import { addT, applyLoss, dispersionAt, inTableRange, numOrRange, resolveTriple, scaleT, triple } from "./physics.js";

export interface Sig extends RouteSig {
  txPort: string;
  launch: Triple;
}

/** One element traversal in a signal's trace tree. */
export interface TNode {
  element: string;
  kind: string;
  inPort?: string;
  outPort?: string;
  /** Static loss (positive dB). */
  loss?: Triple;
  cd: number;
  /** Amplifier node id: gain filled in during evaluation. */
  amp?: string;
  note?: string;
  /** Joint that counts as a connector (for connector ageing). */
  connector?: boolean;
  /** Record the power *before* this step as inbound at (element, inPort). */
  recIn?: boolean;
  /** Record the power *after* this step as outbound at (element, outPort). */
  recOut?: boolean;
  /** Fibre step: direction and whether launch power is taken before the preceding port joint. */
  fibreDir?: "a>b" | "b>a";
  launchFromParent?: boolean;
  parent?: TNode;
  children: TNode[];
  term?: Term;
  tree: number;
  before?: Triple;
  after?: Triple;
  /**
   * Aggregate-basis power after this step: like `after` but without amplifier ripple spreads
   * (flatness / measurement uncertainty), which redistribute power between channels rather than
   * change the total. Used for every Σ-over-channels quantity (amp Pin_total, port/fibre totals).
   */
  agg?: Triple;
  cdAfter: number;
  evaluated: boolean;
  /** Representative signal (branch) id, filled when flattening. */
  sid?: string;
}

export interface Leaf {
  tree: number;
  id: string;
  path: TNode[];
  term: Term;
}

export interface AmpEval {
  id: string;
  comp: AmpComputation;
  nodes: TNode[];
}

export interface Propagation {
  signals: Sig[];
  roots: TNode[];
  leaves: Leaf[];
  amps: AmpEval[];
  cyclicAmps: Set<string>;
  evaluated: TNode[];
}

type Act =
  | { t: "leave"; node: string; port: string }
  | { t: "fibre"; fibre: string; from: End; fromPort: boolean }
  | { t: "arrive"; node: string; port: string };

interface Frame {
  parent: TNode;
  act: Act;
  visited: Set<string>;
  lastAmp?: string;
}

function mk(tree: number, fields: Omit<Partial<TNode>, "cdAfter"> & { element: string; kind: string }): TNode {
  return { cd: 0, children: [], tree, evaluated: false, cdAfter: 0, ...fields };
}

function attach(parent: TNode, n: TNode): TNode {
  n.parent = parent;
  parent.children.push(n);
  return n;
}

function jointNode(tree: number, name: string, j: JointRef | undefined): TNode {
  return mk(tree, {
    element: name,
    kind: "joint",
    loss: j?.loss ?? triple(0),
    connector: j?.connector ?? false,
    note: j?.id || undefined,
  });
}

export interface PropagateOptions {
  warnThreshold: number;
  maxImbalance: number;
}

export function propagate(graph: Graph, catalog: Catalog, issues: Issue[], opts: PropagateOptions): Propagation {
  const dedupe = new Set<string>();
  const issue = (i: Issue, key?: string) => {
    if (key) {
      if (dedupe.has(key)) return;
      dedupe.add(key);
    }
    issues.push(i);
  };
  const ctx: RouteCtx = {
    catalog,
    issue,
    evalSpec(spec: WlSpec, nm: number, element: string, what: string, sig: RouteSig): Triple {
      if (!inTableRange(spec, nm)) {
        issue(
          {
            severity: "error",
            code: "fibre.wavelength_out_of_table",
            element,
            channel: sig.channel.id,
            message: `${element}: ${what} table does not cover ${nm.toFixed(2)} nm (${sig.channel.id}); end value used`,
            values: { wavelength_nm: nm },
          },
          `oot|${element}|${what}|${sig.channel.id}`,
        );
      }
      return resolveTriple(spec, nm);
    },
  };

  // ---- fibre deltas, cached per (fibre, wavelength)
  const fibreCache = new Map<string, { loss: Triple; cd: number }>();
  const fibreDelta = (f: FibreInfo, sig: RouteSig) => {
    const nm = sig.channel.wavelength_nm;
    const key = `${f.id}|${nm}`;
    let d = fibreCache.get(key);
    if (d) return d;
    const type = f.type!;
    const att = f.inst.attenuation_dB_per_km !== undefined ? triple(f.inst.attenuation_dB_per_km) : ctx.evalSpec(type.attenuation_dB_per_km, nm, f.id, "attenuation", sig);
    let D: number;
    if (f.inst.dispersion_ps_nm_km !== undefined) D = f.inst.dispersion_ps_nm_km;
    else {
      if (type.dispersion.model === "table") ctx.evalSpec(type.dispersion.table, nm, f.id, "dispersion", sig);
      D = dispersionAt(type, nm);
    }
    const loss = addT(scaleT(att, f.length_km), triple(f.inst.extra_loss_dB ?? 0));
    d = { loss, cd: D * f.length_km };
    fibreCache.set(key, d);
    return d;
  };

  // ---- signals
  const signals: Sig[] = [];
  for (const n of graph.nodes.values()) {
    const m = n.model;
    if (!m || m.kind !== "transceiver" || !n.txPort) continue;
    const r = txChannel(m, n.inst.settings, catalog);
    if (!r.channel) continue; // reported by validate
    const ch: Channel = r.channel;
    const ov = n.inst.settings?.tx_power_override_dBm;
    signals.push({
      id: `${n.id}.${n.txPort}:${ch.id}`,
      txNode: n.id,
      txPort: n.txPort,
      channel: ch,
      launch: ov !== undefined ? triple(ov) : numOrRange(m.tx.power_dBm),
    });
  }

  // ---- pass 1: topology trace (no powers)
  const roots: TNode[] = [];
  const ampEdges = new Map<string, Set<string>>();
  const ampSeen: string[] = [];
  const ampSeenSet = new Set<string>();
  const cyclicAmps = new Set<string>();
  const seeAmp = (a: string) => {
    if (!ampSeenSet.has(a)) {
      ampSeenSet.add(a);
      ampSeen.push(a);
    }
  };

  signals.forEach((sig, tree) => {
    const root = mk(tree, { element: sig.txNode, kind: "transceiver", outPort: sig.txPort, recOut: true, note: "Tx" });
    roots.push(root);
    const stack: Frame[] = [{ parent: root, act: { t: "leave", node: sig.txNode, port: sig.txPort }, visited: new Set() }];

    const deadEnd = (at: TNode, where: string) => {
      at.term = {
        kind: "dead_end",
        element: sig.txNode,
        check: { code: "topology.unterminated_tx", status: "warn", message: `${sig.id} is unterminated: ends at ${where}`, values: { at: where } },
      };
    };
    const onLoop = (at: TNode, match: (n: TNode) => boolean, where: string) => {
      const amps: string[] = [];
      let n: TNode | undefined = at;
      while (n && !match(n)) {
        if (n.amp) amps.push(n.amp);
        n = n.parent;
      }
      if (n?.amp) amps.push(n.amp);
      if (amps.length) {
        for (const a of amps) {
          cyclicAmps.add(a);
          issue(
            { severity: "error", code: "topology.amplified_loop", element: a, message: `${a} is inside an amplified loop (via ${sig.id} at ${where}); gain cannot be computed` },
            `aloop|${a}`,
          );
        }
        at.term = { kind: "loop", element: amps[0], silent: true, check: { code: "topology.amplified_loop", status: "fail", message: `${sig.id} circulates through amplified loop at ${where}` } };
      } else {
        at.term = {
          kind: "loop",
          element: where.split(".")[0],
          check: { code: "topology.loop", status: "fail", message: `${sig.id} re-enters ${where}: loop`, values: { at: where } },
        };
      }
    };

    while (stack.length) {
      const fr = stack.pop()!;
      let { parent, act, lastAmp } = fr;
      const visited = fr.visited;
      for (;;) {
        if (act.t === "leave") {
          const link = graph.portLinks.get(`${act.node}.${act.port}`);
          if (!link) {
            deadEnd(parent, `${act.node}.${act.port}`);
            break;
          }
          parent = attach(parent, jointNode(tree, portJointName(act.node, act.port, link.fibre, link.end), link.joint));
          act = { t: "fibre", fibre: link.fibre, from: link.end, fromPort: true };
          continue;
        }
        if (act.t === "fibre") {
          const key = `F|${act.fibre}|${act.from}`;
          const fid = act.fibre;
          const from = act.from;
          if (visited.has(key)) {
            onLoop(parent, (n) => n.kind === "fibre" && n.element === fid && n.inPort === from, `${fid}.${from}`);
            break;
          }
          visited.add(key);
          const f = graph.fibres.get(fid)!;
          const far = other(from);
          const d = fibreDelta(f, sig);
          const fn = attach(
            parent,
            mk(tree, {
              element: f.id,
              kind: "fibre",
              inPort: from,
              outPort: far,
              loss: d.loss,
              cd: d.cd,
              fibreDir: from === "a" ? "a>b" : "b>a",
              launchFromParent: act.fromPort,
              note: `${f.length_km} km`,
            }),
          );
          const tgt = f.ends[far].target;
          if (!tgt) {
            deadEnd(fn, `${f.id}.${far}`);
            break;
          }
          if (tgt.kind === "fibre") {
            const tf = graph.fibres.get(tgt.fibre);
            if (!tf?.type) {
              deadEnd(fn, `${f.id}.${far}`);
              break;
            }
            parent = attach(fn, jointNode(tree, junctionName(f.id, far, tgt.fibre, tgt.end), f.ends[far].joint));
            act = { t: "fibre", fibre: tgt.fibre, from: tgt.end, fromPort: false };
            continue;
          }
          parent = attach(fn, jointNode(tree, portJointName(tgt.node, tgt.port, f.id, far), f.ends[far].joint));
          act = { t: "arrive", node: tgt.node, port: tgt.port };
          continue;
        }
        // arrive at a node port
        const node = graph.nodes.get(act.node)!;
        const port = act.port;
        const key = `P|${node.id}.${port}`;
        if (visited.has(key)) {
          onLoop(parent, (n) => n.kind !== "fibre" && n.kind !== "joint" && n.element === node.id && n.inPort === port, `${node.id}.${port}`);
          break;
        }
        visited.add(key);
        const kind = node.model!.kind;
        const spec = node.ports[port];
        if (spec?.direction === "out") {
          const dn = attach(parent, mk(tree, { element: node.id, kind, inPort: port, recIn: true }));
          dn.term = {
            kind: "dead_end",
            element: node.id,
            port,
            check: { code: "topology.direction_conflict", status: "fail", message: `${sig.id} arrives at ${node.id}.${port}, an output-only port` },
          };
          break;
        }
        const outs = route(ctx, node, port, sig);
        const branches: { dn: TNode; out: string; lastAmp?: string }[] = [];
        for (const o of outs) {
          const dn = attach(
            parent,
            mk(tree, {
              element: node.id,
              kind,
              inPort: port,
              outPort: o.outPort,
              loss: o.amp ? undefined : o.loss ?? triple(0),
              cd: o.cd ?? 0,
              amp: o.amp ? node.id : undefined,
              note: o.note,
              recIn: true,
              recOut: !!o.outPort,
            }),
          );
          if (o.term || !o.outPort) {
            dn.term = o.term ?? { kind: "dead_end", element: sig.txNode };
            continue;
          }
          let la = lastAmp;
          if (o.amp) {
            seeAmp(node.id);
            if (lastAmp) {
              const set = ampEdges.get(lastAmp) ?? new Set<string>();
              set.add(node.id);
              ampEdges.set(lastAmp, set);
            }
            la = node.id;
          }
          if (node.ports[o.outPort]?.direction === "in") {
            dn.term = {
              kind: "dead_end",
              element: node.id,
              port: o.outPort,
              check: { code: "topology.direction_conflict", status: "fail", message: `${sig.id} would leave ${node.id} through input-only port ${o.outPort}` },
            };
            continue;
          }
          branches.push({ dn, out: o.outPort, lastAmp: la });
        }
        if (branches.length === 1) {
          parent = branches[0].dn;
          lastAmp = branches[0].lastAmp;
          act = { t: "leave", node: node.id, port: branches[0].out };
          continue;
        }
        for (let i = branches.length - 1; i >= 0; i--) {
          const b = branches[i];
          stack.push({ parent: b.dn, act: { t: "leave", node: node.id, port: b.out }, visited: new Set(visited), lastAmp: b.lastAmp });
        }
        break;
      }
    }
  });

  // ---- amplifier ordering (Kahn); cycles → amplified loop
  const order = kahn(ampSeen, ampEdges, cyclicAmps);
  for (const a of ampSeen) {
    if (cyclicAmps.has(a))
      issue({ severity: "error", code: "topology.amplified_loop", element: a, message: `${a} is part of an amplifier dependency cycle; gain cannot be computed` }, `aloop|${a}`);
  }

  // ---- pass 2: powers
  const evaluated: TNode[] = [];
  const pending = new Map<string, TNode[]>();
  const work: TNode[] = [];
  roots.forEach((r, i) => {
    r.before = signals[i].launch;
    r.after = signals[i].launch;
    r.agg = signals[i].launch;
    r.cdAfter = 0;
    r.evaluated = true;
    evaluated.push(r);
  });
  // LIFO work stack: push in reverse so signals are evaluated (and recorded) in signal order.
  for (let i = roots.length - 1; i >= 0; i--) {
    const r = roots[i];
    for (let k = r.children.length - 1; k >= 0; k--) work.push(r.children[k]);
  }
  const drain = () => {
    while (work.length) {
      const n = work.pop()!;
      const p = n.parent!;
      n.before = p.after;
      if (n.amp) {
        const l = pending.get(n.amp) ?? [];
        l.push(n);
        pending.set(n.amp, l);
        continue;
      }
      n.after = n.loss ? applyLoss(n.before!, n.loss) : n.before;
      n.agg = n.loss ? applyLoss(p.agg!, n.loss) : p.agg;
      n.cdAfter = p.cdAfter + n.cd;
      n.evaluated = true;
      evaluated.push(n);
      for (let k = n.children.length - 1; k >= 0; k--) work.push(n.children[k]);
    }
  };
  drain();
  const amps: AmpEval[] = [];
  for (const a of order) {
    const nodes = pending.get(a) ?? [];
    pending.delete(a);
    if (!nodes.length) continue;
    const info = graph.nodes.get(a)!;
    const model = info.model;
    if (!model || model.kind !== "amplifier") continue;
    const comp = computeAmplifier(
      a,
      model,
      info.inst.settings,
      nodes.map((n) => ({ channel: signals[n.tree].channel, pin: n.before!, pinAgg: n.parent!.agg! })),
      opts,
    );
    for (const i of comp.issues) issues.push(i);
    nodes.forEach((n, k) => {
      n.after = comp.pouts[k];
      n.agg = comp.poutsAgg[k];
      n.cdAfter = n.parent!.cdAfter + n.cd;
      n.evaluated = true;
      evaluated.push(n);
    });
    for (let k = nodes.length - 1; k >= 0; k--) {
      const n = nodes[k];
      for (let c = n.children.length - 1; c >= 0; c--) work.push(n.children[c]);
    }
    amps.push({ id: a, comp, nodes });
    drain();
  }

  // ---- flatten into leaves (one per branch)
  const leaves: Leaf[] = [];
  roots.forEach((root, tree) => {
    const sig = signals[tree];
    const ends: TNode[] = [];
    const st: TNode[] = [root];
    while (st.length) {
      const n = st.pop()!;
      if (!n.evaluated || n.children.length === 0) {
        ends.push(n);
        continue;
      }
      for (let k = n.children.length - 1; k >= 0; k--) st.push(n.children[k]);
    }
    ends.forEach((end, k) => {
      const id = k === 0 ? sig.id : `${sig.id}#${k + 1}`;
      const path: TNode[] = [];
      let term: Term;
      let n: TNode | undefined = end;
      if (!end.evaluated) {
        term = {
          kind: "loop",
          element: end.amp ?? end.element,
          silent: true,
          check: { code: "topology.amplified_loop", status: "fail", message: `${id} passes ${end.amp ?? end.element}, which is in an amplified loop; not computed beyond it` },
        };
        n = end.parent;
      } else term = end.term ?? { kind: "dead_end", element: sig.txNode };
      while (n) {
        path.push(n);
        if (n.sid === undefined) n.sid = id;
        n = n.parent;
      }
      path.reverse();
      leaves.push({ tree, id, path, term });
    });
  });

  return { signals, roots, leaves, amps, cyclicAmps, evaluated };
}

/** Kahn's algorithm over amplifiers; nodes on (or only reachable through) cycles are excluded and cycle members added to `cyclic`. */
function kahn(nodes: string[], edges: Map<string, Set<string>>, cyclic: Set<string>): string[] {
  const run = (exclude: Set<string>) => {
    const indeg = new Map<string, number>();
    for (const n of nodes) if (!exclude.has(n)) indeg.set(n, 0);
    for (const [a, bs] of edges) {
      if (exclude.has(a)) continue;
      for (const b of bs) if (indeg.has(b)) indeg.set(b, indeg.get(b)! + 1);
    }
    const q = nodes.filter((n) => indeg.get(n) === 0);
    const out: string[] = [];
    while (q.length) {
      const n = q.shift()!;
      out.push(n);
      for (const b of edges.get(n) ?? []) {
        if (!indeg.has(b)) continue;
        const d = indeg.get(b)! - 1;
        indeg.set(b, d);
        if (d === 0) q.push(b);
      }
    }
    return { out, rest: [...indeg.keys()].filter((n) => !out.includes(n)) };
  };
  let r = run(cyclic);
  if (r.rest.length) {
    const rest = new Set(r.rest);
    // Members of a cycle can reach themselves within `rest`.
    for (const s of rest) {
      const seen = new Set<string>();
      const st = [...(edges.get(s) ?? [])].filter((x) => rest.has(x));
      let self = false;
      while (st.length && !self) {
        const x = st.pop()!;
        if (x === s) self = true;
        if (seen.has(x)) continue;
        seen.add(x);
        for (const y of edges.get(x) ?? []) if (rest.has(y)) st.push(y);
      }
      if (self) cyclic.add(s);
    }
    r = run(cyclic);
  }
  return r.out;
}
