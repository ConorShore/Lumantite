import {
  CatalogEntryLoose,
  DeviceModel,
  WavelengthPlan,
  ghzToNm,
  nmToGhz,
  type Channel,
  type Issue,
  type JointModel,
  type MuxModel,
  type NodeSettings,
  type PortSpec,
  type TransceiverModel,
} from "@optiplanner/schema";

export interface Catalog {
  models: Map<string, DeviceModel>;
  plans: Map<string, WavelengthPlan>;
  channel(plan: string, id: string): Channel | undefined;
  channels(plan: string): Channel[];
}

class CatalogImpl implements Catalog {
  private chans = new Map<string, { list: Channel[]; byId: Map<string, Channel> }>();
  constructor(
    public models: Map<string, DeviceModel>,
    public plans: Map<string, WavelengthPlan>,
  ) {
    for (const [id, p] of plans) {
      const list: Channel[] = [];
      const byId = new Map<string, Channel>();
      for (const c of p.channels) {
        const frequency_GHz = c.frequency_GHz ?? nmToGhz(c.wavelength_nm!);
        const wavelength_nm = c.wavelength_nm ?? ghzToNm(c.frequency_GHz!);
        const ch: Channel = { plan: id, id: c.id, frequency_GHz, wavelength_nm };
        if (c.label !== undefined) ch.label = c.label;
        list.push(ch);
        byId.set(c.id, ch);
      }
      this.chans.set(id, { list, byId });
    }
  }
  channel(plan: string, id: string): Channel | undefined {
    return this.chans.get(plan)?.byId.get(id);
  }
  channels(plan: string): Channel[] {
    return this.chans.get(plan)?.list ?? [];
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep merge: objects merge recursively, child wins; arrays and scalars are replaced. */
export function deepMerge(parent: unknown, child: unknown): unknown {
  if (!isPlainObject(parent) || !isPlainObject(child)) return child === undefined ? parent : child;
  const out: Record<string, unknown> = { ...parent };
  for (const [k, v] of Object.entries(child)) {
    out[k] = k in parent ? deepMerge(parent[k], v) : v;
  }
  return out;
}

function zodMessage(err: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return err.issues
    .slice(0, 5)
    .map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/**
 * Resolve `extends` chains (deep merge, child wins) and validate each entry with
 * DeviceModel / WavelengthPlan. Later entries with the same id replace earlier ones
 * (project-local catalog overrides shared). Invalid entries are dropped and reported.
 */
export function resolveCatalog(entries: unknown[]): { catalog: Catalog; issues: Issue[] } {
  const issues: Issue[] = [];
  const raw = new Map<string, Record<string, unknown>>();
  const rawPlans = new Map<string, unknown>();

  entries.forEach((e, index) => {
    const loose = CatalogEntryLoose.safeParse(e);
    if (!loose.success) {
      const id = isPlainObject(e) && typeof e.id === "string" ? e.id : `#${index}`;
      issues.push({
        severity: "error",
        code: "catalog.invalid_model",
        element: id,
        message: `Catalog entry ${id}: ${zodMessage(loose.error)}`,
      });
      return;
    }
    if (loose.data.kind === "wavelength-plan") rawPlans.set(loose.data.id, e);
    else raw.set(loose.data.id, e as Record<string, unknown>);
  });

  const plans = new Map<string, WavelengthPlan>();
  for (const [id, e] of rawPlans) {
    const p = WavelengthPlan.safeParse(e);
    if (p.success) plans.set(id, p.data);
    else
      issues.push({
        severity: "error",
        code: "catalog.invalid_model",
        element: id,
        message: `Wavelength plan ${id}: ${zodMessage(p.error)}`,
      });
  }

  // Resolve extends on raw entries.
  const merged = new Map<string, Record<string, unknown> | null>();
  const resolving = new Set<string>();
  const cycleReported = new Set<string>();
  const resolve = (id: string, chain: string[]): Record<string, unknown> | null => {
    if (merged.has(id)) return merged.get(id)!;
    const entry = raw.get(id);
    if (!entry) return null;
    if (resolving.has(id)) {
      const cyc = chain.slice(chain.indexOf(id));
      for (const c of cyc) {
        if (cycleReported.has(c)) continue;
        cycleReported.add(c);
        issues.push({
          severity: "error",
          code: "catalog.extends_cycle",
          element: c,
          message: `extends cycle: ${[...cyc, id].join(" → ")}`,
        });
      }
      return null;
    }
    const ext = entry.extends;
    if (typeof ext !== "string") {
      merged.set(id, entry);
      return entry;
    }
    resolving.add(id);
    const parent = resolve(ext, [...chain, id]);
    resolving.delete(id);
    if (!parent) {
      if (!raw.has(ext)) {
        issues.push({
          severity: "error",
          code: "catalog.unknown_model",
          element: id,
          message: `${id} extends unknown model ${ext}`,
          values: { extends: ext },
        });
      } else if (!cycleReported.has(id)) {
        cycleReported.add(id);
        issues.push({
          severity: "error",
          code: "catalog.extends_cycle",
          element: id,
          message: `${id} extends ${ext}, which is part of an extends cycle`,
        });
      }
      merged.set(id, null);
      return null;
    }
    if (parent.kind !== entry.kind) {
      issues.push({
        severity: "error",
        code: "catalog.invalid_model",
        element: id,
        message: `${id} (${String(entry.kind)}) extends ${ext} of a different kind (${String(parent.kind)})`,
      });
      merged.set(id, null);
      return null;
    }
    const m = deepMerge(parent, entry) as Record<string, unknown>;
    m.extends = ext;
    merged.set(id, m);
    return m;
  };

  const models = new Map<string, DeviceModel>();
  for (const id of raw.keys()) {
    const m = resolve(id, []);
    if (!m) continue;
    const parsed = DeviceModel.safeParse(m);
    if (!parsed.success) {
      issues.push({
        severity: "error",
        code: "catalog.invalid_model",
        element: id,
        message: `Model ${id}: ${zodMessage(parsed.error)}`,
      });
      continue;
    }
    models.set(id, parsed.data);
  }

  // Cross references.
  const jointKnown = (j: string | undefined) => j === undefined || models.get(j)?.kind === "joint";
  for (const [id, m] of models) {
    if (m.kind === "mux" && !plans.has(m.plan)) {
      issues.push({ severity: "error", code: "catalog.unknown_plan", element: id, message: `Mux ${id}: unknown wavelength plan ${m.plan}`, values: { plan: m.plan } });
    }
    if (m.kind === "transceiver" && "plan" in m.tx.wavelength && !plans.has(m.tx.wavelength.plan)) {
      issues.push({ severity: "error", code: "catalog.unknown_plan", element: id, message: `Transceiver ${id}: unknown wavelength plan ${m.tx.wavelength.plan}`, values: { plan: m.tx.wavelength.plan } });
    }
    const refs: string[] = [];
    if (m.kind === "fibre" && m.default_joint) refs.push(m.default_joint);
    if ("connector" in m && typeof m.connector === "string") refs.push(m.connector);
    if ("ports" in m && m.ports) for (const p of Object.values(m.ports)) if (p.connector) refs.push(p.connector);
    for (const r of new Set(refs)) {
      if (!jointKnown(r)) {
        issues.push({ severity: "warn", code: "catalog.unknown_joint", element: id, message: `Model ${id} references unknown joint model ${r}`, values: { joint: r } });
      }
    }
  }

  return { catalog: new CatalogImpl(models, plans), issues };
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

const portCache = new WeakMap<object, Record<string, PortSpec>>();

function buildPorts(model: DeviceModel, catalog: Catalog): Record<string, PortSpec> {
  const gen: Record<string, PortSpec> = {};
  let explicit: Record<string, PortSpec> | undefined;
  let connector: string | undefined;
  switch (model.kind) {
    case "transceiver":
      if (model.ports) explicit = model.ports;
      else {
        gen.tx = { direction: "out" };
        gen.rx = { direction: "in" };
      }
      connector = model.connector;
      break;
    case "mux": {
      gen.common = { direction: "bidi" };
      const all = catalog.channels(model.plan);
      const ids = model.channel_ports === "all" ? all.map((c) => c.id) : model.channel_ports;
      for (const id of ids) gen[id] = { direction: "bidi", channel: id };
      if (model.express_port) gen.express = { direction: "bidi" };
      if (model.monitor_port) gen.monitor = { direction: "out" };
      explicit = model.ports;
      connector = model.connector;
      break;
    }
    case "amplifier":
      gen.in = { direction: "in" };
      gen.out = { direction: "out" };
      explicit = model.ports;
      connector = model.connector;
      break;
    case "attenuator":
    case "dcm":
      gen.in = { direction: "bidi" };
      gen.out = { direction: "bidi" };
      explicit = model.ports;
      connector = model.connector;
      break;
    case "splitter":
      gen.in = { direction: "bidi" };
      model.ratio.forEach((_, i) => (gen[`out${i + 1}`] = { direction: "bidi" }));
      explicit = model.ports;
      connector = model.connector;
      break;
    case "passthrough":
      for (const [a, b] of model.paths ?? [["in", "out"]]) {
        gen[a] = { direction: "bidi" };
        gen[b] = { direction: "bidi" };
      }
      explicit = model.ports;
      connector = model.connector;
      break;
    default:
      return {};
  }
  const out: Record<string, PortSpec> = {};
  for (const [k, v] of Object.entries(gen)) out[k] = { ...v };
  if (explicit) for (const [k, v] of Object.entries(explicit)) out[k] = { ...(out[k] ?? {}), ...v };
  if (connector) for (const p of Object.values(out)) if (p.connector === undefined) p.connector = connector;
  return out;
}

/** Effective port map of a model incl. generated ports, defaults applied. Returns a fresh object. */
export function portsOf(model: DeviceModel, catalog: Catalog): Record<string, PortSpec> {
  const p = buildPorts(model, catalog);
  return p;
}

/** Cached, read-only variant used internally. */
export function portsCached(model: DeviceModel, catalog: Catalog): Record<string, PortSpec> {
  let p = portCache.get(model);
  if (!p) {
    p = buildPorts(model, catalog);
    portCache.set(model, p);
  }
  return p;
}

/** Which port transmits and which receives on a transceiver. BiDi: both are the bidi port. */
export function transceiverPorts(model: TransceiverModel, ports: Record<string, PortSpec>): { tx?: string; rx?: string } {
  const names = Object.keys(ports);
  let tx: string | undefined;
  let rx: string | undefined;
  if (ports.tx && ports.tx.direction !== "in") tx = "tx";
  else tx = names.find((n) => ports[n].direction === "out") ?? names.find((n) => ports[n].direction === "bidi");
  if (ports.rx && ports.rx.direction !== "out") rx = "rx";
  else rx = names.find((n) => ports[n].direction === "in") ?? names.find((n) => ports[n].direction === "bidi");
  void model;
  return { tx, rx };
}

/** Ad-hoc channel for grey optics. */
export function greyChannel(nm: number): Channel {
  return { plan: "grey", id: `${nm}nm`, wavelength_nm: nm, frequency_GHz: nmToGhz(nm) };
}

/** Resolve the transmit channel of a transceiver instance. */
export function txChannel(
  model: TransceiverModel,
  settings: NodeSettings | undefined,
  catalog: Catalog,
): { channel?: Channel; error?: string } {
  const w = model.tx.wavelength;
  if ("wavelength_nm" in w) return { channel: greyChannel(w.wavelength_nm) };
  if (!catalog.plans.has(w.plan)) return { error: `unknown wavelength plan ${w.plan}` };
  if ("channel" in w) {
    const c = catalog.channel(w.plan, w.channel);
    return c ? { channel: c } : { error: `channel ${w.channel} not in plan ${w.plan}` };
  }
  const chosen = settings?.channel;
  if (chosen === undefined) return { error: `tunable transceiver needs settings.channel (plan ${w.plan})` };
  if (w.channels !== "all" && !w.channels.includes(chosen)) return { error: `channel ${chosen} not supported by this tunable model` };
  const c = catalog.channel(w.plan, chosen);
  return c ? { channel: c } : { error: `channel ${chosen} not in plan ${w.plan}` };
}

// ---------------------------------------------------------------------------
// Mux channel matching
// ---------------------------------------------------------------------------

interface MuxTable {
  ports: { port: string; ch: Channel }[];
  tolGHz: number;
}
const muxCache = new WeakMap<object, MuxTable>();

/** Channel ports of a mux with their channels, and the frequency tolerance used for matching. */
export function muxTable(model: MuxModel, ports: Record<string, PortSpec>, catalog: Catalog): MuxTable {
  let t = muxCache.get(model);
  if (t) return t;
  const list: { port: string; ch: Channel }[] = [];
  for (const [name, spec] of Object.entries(ports)) {
    if (!spec.channel) continue;
    const ch = catalog.channel(model.plan, spec.channel);
    if (ch) list.push({ port: name, ch });
  }
  let tolGHz: number;
  if (model.passband_ghz !== undefined) tolGHz = model.passband_ghz / 2;
  else {
    const fs = catalog.channels(model.plan).map((c) => c.frequency_GHz).sort((a, b) => a - b);
    let minSp = Infinity;
    for (let i = 1; i < fs.length; i++) minSp = Math.min(minSp, fs[i] - fs[i - 1]);
    tolGHz = Number.isFinite(minSp) && minSp > 0 ? minSp / 4 : 1;
  }
  t = { ports: list, tolGHz };
  muxCache.set(model, t);
  return t;
}

export function channelMatches(sig: Channel, portCh: Channel, tolGHz: number): boolean {
  if (sig.plan === portCh.plan && sig.id === portCh.id) return true;
  return Math.abs(sig.frequency_GHz - portCh.frequency_GHz) <= tolGHz + 1e-6;
}

/** The channel port a signal arriving at `common` should leave on, if any. */
export function muxPortFor(t: MuxTable, sig: Channel): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const p of t.ports) {
    if (p.ch.plan === sig.plan && p.ch.id === sig.id) return p.port;
    const d = Math.abs(p.ch.frequency_GHz - sig.frequency_GHz);
    if (d <= t.tolGHz + 1e-6 && d < bestD) {
      bestD = d;
      best = p.port;
    }
  }
  return best;
}

export function jointModel(catalog: Catalog, id: string | undefined): JointModel | undefined {
  if (!id) return undefined;
  const m = catalog.models.get(id);
  return m?.kind === "joint" ? m : undefined;
}
