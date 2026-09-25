import type { AttenuatorModel, DcmModel, NodeSettings, PassthroughModel, SplitterModel } from "@lumantite/schema";
import type { NodeInfo } from "../graph.js";
import { addLoss, numOrRange, triple } from "../physics.js";
import { warnTerm, type RouteCtx, type RouteOut, type RouteSig } from "./types.js";

function deadEnd(node: NodeInfo, inPort: string, sig: RouteSig): RouteOut[] {
  return [{ term: warnTerm("dead_end", "topology.unterminated_tx", `${sig.id} enters ${node.id}.${inPort}, which does not route anywhere`, node.id, inPort) }];
}

/** Fixed attenuator (`loss_dB`) or VOA (`range_dB` + instance `setting_dB`). Bidirectional in ↔ out. */
export function routeAttenuator(ctx: RouteCtx, node: NodeInfo, m: AttenuatorModel, inPort: string, sig: RouteSig): RouteOut[] {
  const out = inPort === "in" ? "out" : inPort === "out" ? "in" : undefined;
  if (!out) return deadEnd(node, inPort, sig);
  const s: NodeSettings = node.inst.settings ?? {};
  let loss;
  let note: string | undefined;
  if (m.range_dB) {
    const v = s.setting_dB ?? m.range_dB.min;
    loss = triple(v);
    note = `VOA ${v} dB`;
  } else if (m.loss_dB !== undefined) loss = ctx.evalSpec(m.loss_dB, sig.channel.wavelength_nm, node.id, "loss", sig);
  else loss = triple(0);
  return [{ outPort: out, loss, note }];
}

/** DCM: insertion loss + (negative) dispersion, both optionally per wavelength. */
export function routeDcm(ctx: RouteCtx, node: NodeInfo, m: DcmModel, inPort: string, sig: RouteSig): RouteOut[] {
  const out = inPort === "in" ? "out" : inPort === "out" ? "in" : undefined;
  if (!out) return deadEnd(node, inPort, sig);
  const nm = sig.channel.wavelength_nm;
  const loss = ctx.evalSpec(m.insertion_loss_dB, nm, node.id, "insertion loss", sig);
  const cd = typeof m.dispersion_ps_nm === "number" ? m.dispersion_ps_nm : ctx.evalSpec(m.dispersion_ps_nm, nm, node.id, "dispersion", sig).typ;
  return [{ outPort: out, loss, cd }];
}

/** Splitter: in → every outN with 10·log10(100/pct) + excess; outN → in with the same leg loss. */
export function routeSplitter(_ctx: RouteCtx, node: NodeInfo, m: SplitterModel, inPort: string, sig: RouteSig): RouteOut[] {
  const excess = m.excess_loss_dB !== undefined ? numOrRange(m.excess_loss_dB) : triple(0);
  const leg = (i: number) => addLoss(triple(10 * Math.log10(100 / m.ratio[i])), excess);
  if (inPort === "in") return m.ratio.map((pct, i) => ({ outPort: `out${i + 1}`, loss: leg(i), note: `${pct}%` }));
  const mm = /^out(\d+)$/.exec(inPort);
  if (mm) {
    const i = Number(mm[1]) - 1;
    if (i >= 0 && i < m.ratio.length) return [{ outPort: "in", loss: leg(i), note: `${m.ratio[i]}%` }];
  }
  return deadEnd(node, inPort, sig);
}

/** Passthrough: bidirectional port pairs, insertion loss (scalar or wavelength table). */
export function routePassthrough(ctx: RouteCtx, node: NodeInfo, m: PassthroughModel, inPort: string, sig: RouteSig): RouteOut[] {
  const paths = m.paths ?? [["in", "out"]];
  for (const [a, b] of paths) {
    const out = inPort === a ? b : inPort === b ? a : undefined;
    if (out) return [{ outPort: out, loss: ctx.evalSpec(m.insertion_loss_dB, sig.channel.wavelength_nm, node.id, "insertion loss", sig) }];
  }
  return deadEnd(node, inPort, sig);
}

