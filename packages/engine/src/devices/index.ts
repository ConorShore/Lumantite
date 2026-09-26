import type { NodeInfo } from "../graph.js";
import { routeAmplifier } from "./amplifier.js";
import { routeMux } from "./mux.js";
import { routeAttenuator, routeDcm, routePassthrough, routeSplitter } from "./passive.js";
import { routeTransceiver } from "./transceiver.js";
import { warnTerm, type RouteCtx, type RouteOut, type RouteSig } from "./types.js";

export * from "./types.js";
export { computeAmplifier, type AmpComputation, type AmpInput, type AmpOptions } from "./amplifier.js";

/** The device-class transfer function: route(signal, inPort) → [(outPort, Δpower, Δcd)]. */
export function route(ctx: RouteCtx, node: NodeInfo, inPort: string, sig: RouteSig): RouteOut[] {
  const m = node.model!;
  switch (m.kind) {
    case "transceiver":
      return routeTransceiver(node, inPort, sig);
    case "mux":
      return routeMux(ctx, node, m, inPort, sig);
    case "amplifier":
      return routeAmplifier(node, inPort, sig);
    case "attenuator":
      return routeAttenuator(ctx, node, m, inPort, sig);
    case "dcm":
      return routeDcm(ctx, node, m, inPort, sig);
    case "splitter":
      return routeSplitter(ctx, node, m, inPort, sig);
    case "passthrough":
      return routePassthrough(ctx, node, m, inPort, sig);
    default:
      return [{ term: warnTerm("dead_end", "topology.unterminated_tx", `${sig.id} enters ${node.id}.${inPort} (${m.kind}), which does not route light`, node.id, inPort) }];
  }
}
