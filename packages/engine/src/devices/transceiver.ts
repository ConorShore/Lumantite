import type { NodeInfo } from "../graph.js";
import { failTerm, type RouteOut, type RouteSig } from "./types.js";

/** A signal arriving at a transceiver: received on the rx (or bidi) port, anything else is a direction conflict. */
export function routeTransceiver(node: NodeInfo, inPort: string, sig: RouteSig): RouteOut[] {
  if (inPort === node.rxPort) return [{ term: { kind: "rx", rx: { node: node.id, port: inPort } }, note: "Rx" }];
  return [
    {
      term: failTerm(
        "dead_end",
        "topology.direction_conflict",
        `${sig.id} arrives at ${node.id}.${inPort}, which is not a receive port`,
        node.id,
        inPort,
      ),
    },
  ];
}
