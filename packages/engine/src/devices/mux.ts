import type { Check, MuxModel, Triple } from "@lumantite/schema";
import { channelMatches, muxPortFor, muxTable } from "../catalog.js";
import type { NodeInfo } from "../graph.js";
import { addLoss, EPS, triple } from "../physics.js";
import { failTerm, warnTerm, type RouteCtx, type RouteOut, type RouteSig } from "./types.js";

/** Through loss of a monitor tap, dB: −10·log10(1 − 10^(−tap/10)) (SPEC 7.10 R12). */
export function tapThroughLoss(tap_dB: number): number {
  return -10 * Math.log10(1 - Math.pow(10, -tap_dB / 10));
}

/** R10: occupied bandwidth vs passband at a channel port; the signal continues, an error is raised at the mux. */
function passband(ctx: RouteCtx, node: NodeInfo, model: MuxModel, port: string, sig: RouteSig): Check | undefined {
  const pb = model.passband_ghz;
  if (pb === undefined || sig.bw_GHz === undefined || sig.bw_GHz <= pb + EPS) return undefined;
  const message = `${sig.id}: occupied bandwidth ${sig.bw_GHz.toFixed(1)} GHz exceeds ${node.id}.${port} passband ${pb} GHz`;
  const values = { bandwidth_GHz: sig.bw_GHz, passband_GHz: pb };
  ctx.issue(
    { severity: "error", code: "mux.passband_exceeded", element: node.id, port, channel: sig.channel.id, message, values: { ...values, signal: sig.id } },
    `pb|${node.id}|${port}|${sig.id}`,
  );
  return { code: "mux.passband_exceeded", status: "fail", margin: pb - sig.bw_GHz, values: { ...values, mux: node.id, port }, message };
}

/**
 * Mux / demux / OADM (SPEC 5.4, 7.5). Direction-agnostic:
 *  - channel port → common, channel-port loss (override or default); wrong wavelength → error, blocked.
 *  - common → matching channel port; no match → express (express loss) or dropped with a warning.
 *  - express → common with express loss.
 */
export function routeMux(ctx: RouteCtx, node: NodeInfo, model: MuxModel, inPort: string, sig: RouteSig): RouteOut[] {
  const t = muxTable(model, node.ports, ctx.catalog);
  const nm = sig.channel.wavelength_nm;
  const chLoss = (port: string) =>
    ctx.evalSpec(model.port_overrides?.[port]?.insertion_loss_dB ?? model.insertion_loss_dB, nm, node.id, `${port} insertion loss`, sig);
  const tap = model.monitor_port ? triple(tapThroughLoss(model.monitor_port.tap_dB)) : undefined;
  const withTap = (l: Triple) => (tap ? addLoss(l, tap) : l);
  const exLoss = () => withTap(ctx.evalSpec(model.express_port!.insertion_loss_dB, nm, node.id, "express insertion loss", sig));

  if (inPort === "common") {
    const p = muxPortFor(t, sig.channel);
    if (p) return [{ outPort: p, loss: withTap(chLoss(p)), check: passband(ctx, node, model, p, sig) }];
    if (model.express_port && node.ports.express) return [{ outPort: "express", loss: exLoss(), note: "express" }];
    return [
      {
        note: "dropped",
        term: warnTerm(
          "dropped",
          "mux.channel_dropped",
          `${sig.id} (${sig.channel.id}) has no matching channel port at ${node.id}.common and no express port: dropped`,
          node.id,
          "common",
        ),
      },
    ];
  }
  if (inPort === "express" && model.express_port) return [{ outPort: "common", loss: exLoss(), note: "express" }];

  const spec = node.ports[inPort];
  if (spec?.channel) {
    const pc = ctx.catalog.channel(model.plan, spec.channel);
    if (pc && channelMatches(sig.channel, pc, t.tolGHz)) return [{ outPort: "common", loss: withTap(chLoss(inPort)), check: passband(ctx, node, model, inPort, sig) }];
    return [
      {
        note: "blocked",
        term: failTerm(
          "dropped",
          "mux.wrong_channel",
          `${sig.id} (${sig.channel.id}, ${sig.channel.wavelength_nm.toFixed(2)} nm) enters channel port ${node.id}.${inPort} (${spec.channel}): blocked`,
          node.id,
          inPort,
        ),
      },
    ];
  }
  return [
    {
      term: warnTerm("dead_end", "topology.unterminated_tx", `${sig.id} enters ${node.id}.${inPort}, which does not route anywhere`, node.id, inPort),
    },
  ];
}
