import type { DeviceModel, FibreInst, FibreModel, Issue, NodeInst, PortSpec, ProjectModel, Triple } from "@optiplanner/schema";
import { jointModel, portsCached, transceiverPorts, type Catalog } from "./catalog.js";
import { numOrRange, triple } from "./physics.js";

export type End = "a" | "b";

export type EndTarget =
  | { kind: "port"; node: string; port: string }
  | { kind: "fibre"; fibre: string; end: End };

export interface JointRef {
  /** Joint model id, or "" when none could be determined. */
  id: string;
  loss: Triple;
  family?: string;
  /** Counts towards `connector_ageing × n_connectors` (anything that is not a splice). */
  connector: boolean;
}

export interface EndInfo {
  target?: EndTarget;
  joint?: JointRef;
}

export interface FibreInfo {
  id: string;
  inst: FibreInst & { file?: string };
  type?: FibreModel;
  length_km: number;
  ends: { a: EndInfo; b: EndInfo };
}

export interface NodeInfo {
  id: string;
  index: number;
  inst: NodeInst & { file?: string };
  model?: DeviceModel;
  ports: Record<string, PortSpec>;
  /** Transceivers only. */
  txPort?: string;
  rxPort?: string;
}

export interface PortLink {
  fibre: string;
  end: End;
  joint?: JointRef;
}

export interface Graph {
  nodes: Map<string, NodeInfo>;
  fibres: Map<string, FibreInfo>;
  /** key `${node}.${port}` */
  portLinks: Map<string, PortLink>;
}

/** "node.port" | "fibre.a". Element ids may not contain '.', so split at the FIRST dot (port names such as C21.5 may contain dots). */
export function splitEndpoint(to: string): { element: string; port: string } | null {
  const i = to.indexOf(".");
  if (i <= 0 || i === to.length - 1) return null;
  return { element: to.slice(0, i), port: to.slice(i + 1) };
}

export const other = (e: End): End => (e === "a" ? "b" : "a");

/** Canonical element name for a fibre-to-fibre junction: lexically smaller fibre first. */
export function junctionName(f1: string, e1: End, f2: string, e2: End): string {
  const x = `${f1}.${e1}`;
  const y = `${f2}.${e2}`;
  return x <= y ? `joint:${x}~${y}` : `joint:${y}~${x}`;
}

export function portJointName(node: string, port: string, fibre: string, end: End): string {
  return `joint:${node}.${port}~${fibre}.${end}`;
}

function isSplice(family: string | undefined): boolean {
  return !!family && family.toLowerCase().includes("splice");
}

export function buildGraph(model: ProjectModel, catalog: Catalog): { graph: Graph; issues: Issue[] } {
  const issues: Issue[] = [];
  const nodes = new Map<string, NodeInfo>();
  const fibres = new Map<string, FibreInfo>();
  const portLinks = new Map<string, PortLink>();
  const seen = new Map<string, string>(); // id → "node" | "fibre"

  const jointRef = (id: string | undefined, element: string, port?: string): JointRef | undefined => {
    if (!id) return undefined;
    const jm = jointModel(catalog, id);
    if (!jm) {
      issues.push({
        severity: "error",
        code: "catalog.unknown_joint",
        element,
        port,
        message: `${element}: unknown joint model ${id}`,
        values: { joint: id },
      });
      return { id, loss: triple(0), connector: true };
    }
    return { id, loss: numOrRange(jm.insertion_loss_dB), family: jm.family, connector: !isSplice(jm.family) };
  };

  // ---- nodes
  (model.nodes ?? []).forEach((n, index) => {
    if (seen.has(n.id)) {
      issues.push({ severity: "error", code: "project.duplicate_id", element: n.id, message: `Duplicate id ${n.id}` });
      return;
    }
    seen.set(n.id, "node");
    if (n.id.includes(".")) {
      issues.push({ severity: "error", code: "project.invalid_settings", element: n.id, message: `Node id ${n.id} must not contain '.'` });
    }
    const m = catalog.models.get(n.model);
    const info: NodeInfo = { id: n.id, index, inst: n, ports: {} };
    if (!m) {
      issues.push({ severity: "error", code: "catalog.unknown_model", element: n.id, message: `Node ${n.id}: unknown model ${n.model}`, values: { model: n.model } });
    } else if (m.kind === "fibre" || m.kind === "joint") {
      issues.push({ severity: "error", code: "catalog.invalid_model", element: n.id, message: `Node ${n.id}: model ${n.model} is a ${m.kind}, not a node model`, values: { model: n.model } });
    } else {
      info.model = m;
      info.ports = portsCached(m, catalog);
      if (m.kind === "transceiver") {
        const tp = transceiverPorts(m, info.ports);
        info.txPort = tp.tx;
        info.rxPort = tp.rx;
      }
    }
    nodes.set(n.id, info);
  });

  // ---- fibres
  for (const f of model.fibres ?? []) {
    if (seen.has(f.id)) {
      issues.push({ severity: "error", code: "project.duplicate_id", element: f.id, message: `Duplicate id ${f.id}` });
      continue;
    }
    seen.set(f.id, "fibre");
    if (f.id.includes(".")) {
      issues.push({ severity: "error", code: "project.invalid_settings", element: f.id, message: `Fibre id ${f.id} must not contain '.'` });
    }
    const m = catalog.models.get(f.type);
    let type: FibreModel | undefined;
    if (!m) {
      issues.push({ severity: "error", code: "catalog.unknown_model", element: f.id, message: `Fibre ${f.id}: unknown fibre type ${f.type}`, values: { model: f.type } });
    } else if (m.kind !== "fibre") {
      issues.push({ severity: "error", code: "catalog.invalid_model", element: f.id, message: `Fibre ${f.id}: model ${f.type} is a ${m.kind}, not a fibre`, values: { model: f.type } });
    } else type = m;
    let length = f.length_km ?? type?.default_length_km;
    if (length === undefined) {
      if (type)
        issues.push({ severity: "error", code: "project.invalid_settings", element: f.id, message: `Fibre ${f.id}: no length_km and type ${f.type} has no default_length_km` });
      length = 0;
    }
    fibres.set(f.id, { id: f.id, inst: f, type, length_km: length, ends: { a: {}, b: {} } });
  }

  // ---- endpoints
  const junctionDone = new Set<string>();
  for (const fi of fibres.values()) {
    for (const end of ["a", "b"] as End[]) {
      const fe = fi.inst[end] ?? {};
      if (!fe.to) continue;
      const ep = splitEndpoint(fe.to);
      const where = `${fi.id}.${end}`;
      if (!ep) {
        issues.push({ severity: "error", code: "project.unknown_endpoint", element: fi.id, port: end, message: `${where}: malformed endpoint "${fe.to}"`, values: { to: fe.to } });
        continue;
      }
      const kind = seen.get(ep.element);
      if (!kind) {
        issues.push({ severity: "error", code: "project.unknown_endpoint", element: fi.id, port: end, message: `${where}: unknown element ${ep.element}`, values: { to: fe.to } });
        continue;
      }
      if (kind === "node") {
        const n = nodes.get(ep.element)!;
        if (!n.model) continue; // model problem already reported
        const spec = n.ports[ep.port];
        if (!spec) {
          issues.push({ severity: "error", code: "project.unknown_port", element: fi.id, port: end, message: `${where}: ${n.id} has no port "${ep.port}"`, values: { to: fe.to } });
          continue;
        }
        const jointId = fe.joint ?? fi.type?.default_joint ?? spec.connector;
        const j = jointRef(jointId, fi.id, end);
        if (j && spec.connector) {
          const pj = jointModel(catalog, spec.connector);
          if (pj && j.family !== undefined && pj.family !== j.family) {
            issues.push({
              severity: "error",
              code: "project.joint_family_mismatch",
              element: fi.id,
              port: end,
              message: `${where}: joint ${j.id} (${j.family}) does not fit port ${n.id}.${ep.port} (${spec.connector}, ${pj.family})`,
              values: { joint: j.id, port_connector: spec.connector, fibre_family: j.family, port_family: pj.family },
            });
          }
        }
        const key = `${n.id}.${ep.port}`;
        if (portLinks.has(key)) {
          const prev = portLinks.get(key)!;
          issues.push({ severity: "error", code: "project.endpoint_reused", element: fi.id, port: end, message: `${where}: port ${key} is already used by ${prev.fibre}.${prev.end}`, values: { to: fe.to } });
          continue;
        }
        fi.ends[end].joint = j;
        fi.ends[end].target = { kind: "port", node: n.id, port: ep.port };
        if (fi.type) portLinks.set(key, { fibre: fi.id, end, joint: j });
        continue;
      }
      // fibre → fibre
      const of = fibres.get(ep.element)!;
      if (ep.port !== "a" && ep.port !== "b") {
        issues.push({ severity: "error", code: "project.unknown_port", element: fi.id, port: end, message: `${where}: fibre end must be ${ep.element}.a or ${ep.element}.b`, values: { to: fe.to } });
        continue;
      }
      const oe = ep.port as End;
      if (of.id === fi.id && oe === end) {
        issues.push({ severity: "error", code: "project.unknown_endpoint", element: fi.id, port: end, message: `${where}: a fibre end cannot connect to itself` });
        continue;
      }
      const back = of.inst[oe]?.to;
      const self = `${fi.id}.${end}`;
      if (back !== self) {
        issues.push({
          severity: "error",
          code: "project.endpoint_asymmetric",
          element: fi.id,
          port: end,
          message: `${where} → ${fe.to}, but ${fe.to} ${back ? `→ ${back}` : "is not connected back"}`,
          values: { to: fe.to, back: back ?? "" },
        });
        if (back) continue; // points elsewhere: do not connect
      }
      const jkey = junctionName(fi.id, end, of.id, oe);
      if (junctionDone.has(jkey)) continue;
      junctionDone.add(jkey);
      const myJ = fe.joint ?? fi.type?.default_joint;
      const theirJ = of.inst[oe]?.joint ?? of.type?.default_joint;
      if (myJ && theirJ && myJ !== theirJ) {
        issues.push({
          severity: "error",
          code: "project.joint_family_mismatch",
          element: fi.id,
          port: end,
          message: `${jkey.slice(6)}: both ends of a fibre-to-fibre joint must carry the same joint model (${myJ} vs ${theirJ})`,
          values: { joint: myJ, other_joint: theirJ },
        });
      }
      const jid = myJ ?? theirJ;
      let j: JointRef | undefined;
      if (!jid) {
        issues.push({ severity: "warn", code: "catalog.unknown_joint", element: fi.id, port: end, message: `${jkey.slice(6)}: no joint model on either end; counted as lossless` });
        j = { id: "", loss: triple(0), connector: false };
      } else j = jointRef(jid, fi.id, end);
      if (fi.ends[end].target || of.ends[oe].target) {
        issues.push({ severity: "error", code: "project.endpoint_reused", element: fi.id, port: end, message: `${jkey.slice(6)}: fibre end already connected` });
        continue;
      }
      if (!fi.type || !of.type) continue;
      fi.ends[end] = { target: { kind: "fibre", fibre: of.id, end: oe }, joint: j };
      of.ends[oe] = { target: { kind: "fibre", fibre: fi.id, end }, joint: j };
    }
  }

  return { graph: { nodes, fibres, portLinks }, issues };
}
