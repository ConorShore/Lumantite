/** Derived indexes over Results, cached per Results object. */
import type { Issue, PortResult, Results, SignalResult } from "@lumantite/schema";

function cached<T>(fn: (r: Results) => T): (r: Results | null) => T | null {
  const cache = new WeakMap<Results, T>();
  return (r) => {
    if (!r) return null;
    let v = cache.get(r);
    if (v === undefined) cache.set(r, (v = fn(r)));
    return v;
  };
}

export const portIndex = cached((r) => new Map<string, PortResult>(r.ports.map((p) => [`${p.node}.${p.port}`, p])));

/** element id (node, fibre, joint) → signals passing through it */
export const signalsByElement = cached((r) => {
  const m = new Map<string, SignalResult[]>();
  for (const s of r.signals) for (const step of s.path) {
    const list = m.get(step.element);
    if (!list) m.set(step.element, [s]);
    else if (list[list.length - 1] !== s) list.push(s);
  }
  return m;
});

/** fibre id → set of "plan:channel" keys it carries */
export const fibreChannels = cached((r) => {
  const m = new Map<string, Set<string>>();
  for (const f of r.fibres) {
    const set = new Set<string>();
    for (const d of f.directions) for (const c of d.channels) set.add(`${c.channel.plan}:${c.channel.id}`);
    m.set(f.id, set);
  }
  return m;
});

export const signalById = cached((r) => new Map(r.signals.map((s) => [s.id, s])));

/** Node id a signal id belongs to (`${txNode}.${txPort}:${channel}`; node ids contain no '.'). */
export function signalTxNode(signalId: string): string | null {
  const head = signalId.split(":")[0]!;
  const i = head.indexOf(".");
  return i > 0 ? head.slice(0, i) : null;
}

export function issuesByElement(issues: Issue[]): Map<string, Issue[]> {
  const m = new Map<string, Issue[]>();
  for (const i of issues) {
    const el = i.element?.includes(":") && !i.element.startsWith("joint:") ? signalTxNode(i.element) : i.element;
    if (!el) continue;
    const list = m.get(el);
    if (list) list.push(i);
    else m.set(el, [i]);
  }
  return m;
}
