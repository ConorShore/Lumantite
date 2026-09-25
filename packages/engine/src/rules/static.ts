import type { Issue, ResolvedMargins } from "@lumantite/schema";
import type { Catalog } from "../catalog.js";
import type { Graph } from "../graph.js";

/**
 * Design rules that depend only on the graph and catalog, not on computed powers (SPEC 7.10):
 * R6 polish mismatch, R7 fibre-to-fibre core / type / mode mismatch.
 */
export function staticRules(_graph: Graph, _catalog: Catalog, _margins: ResolvedMargins): Issue[] {
  return [];
}
