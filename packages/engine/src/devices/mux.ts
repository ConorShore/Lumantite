import type { MuxModel } from "@lumantite/schema";
import { channelMatches, muxPortFor, muxTable } from "../catalog.js";
import type { NodeInfo } from "../graph.js";
import { failTerm, warnTerm, type RouteCtx, type RouteOut, type RouteSig } from "./types.js";

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
  const exLoss = () => ctx.evalSpec(model.express_port!.insertion_loss_dB, nm, node.id, "express insertion loss", sig);

  if (inPort === "common") {
    const p = muxPortFor(t, sig.channel);
    if (p) return [{ outPort: p, loss: chLoss(p) }];
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
    if (pc && channelMatches(sig.channel, pc, t.tolGHz)) return [{ outPort: "common", loss: chLoss(inPort) }];
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
