import type { AmplifierResult, FibreResult, Issue, PortResult, ResolvedMargins, SignalResult } from "@lumantite/schema";
import type { Catalog } from "../catalog.js";
import type { Graph } from "../graph.js";

export interface AggregateCtx {
  graph: Graph;
  catalog: Catalog;
  margins: ResolvedMargins;
  warnThreshold: number;
  signals: SignalResult[];
  ports: PortResult[];
  fibres: FibreResult[];
  amplifiers: AmplifierResult[];
}

/**
 * Design rules evaluated on computed results (SPEC 7.10): R3 per-channel launch, R6 reflection
 * risk, R7 path mode mismatch, R8 FWM / water peak, R9 DCM matching, R13 laser class,
 * R17 crosstalk, R18 XPM. May set result fields (e.g. FibreDirectionResult.laserClass) in place.
 * Returned issues are added before element statuses are derived.
 */
export function aggregateRules(_ctx: AggregateCtx): Issue[] {
  return [];
}
