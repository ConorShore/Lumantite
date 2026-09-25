import type { FibreModel, Issue, ResolvedMargins } from "@lumantite/schema";
import { jointModel, type Catalog } from "../catalog.js";
import { junctionName, type End, type Graph } from "../graph.js";

export const isApc = (polish: string): boolean => polish.trim().toUpperCase() === "APC";
export const isMultimode = (t: FibreModel): boolean => t.multimode === true;
/** "ITU-T G.652.D" and "g.652.d" compare equal. */
export const normStandard = (s: string): string => s.toUpperCase().replace(/^ITU-?T\s*/, "").replace(/\s+/g, "");

/**
 * Design rules that depend only on the graph and catalog, not on computed powers (SPEC 7.10):
 * R6 polish mismatch, R7 fibre-to-fibre core / type / mode mismatch.
 */
export function staticRules(graph: Graph, catalog: Catalog, _margins: ResolvedMargins): Issue[] {
  const out: Issue[] = [];
  const done = new Set<string>();
  for (const f of graph.fibres.values()) {
    for (const end of ["a", "b"] as End[]) {
      const e = f.ends[end];
      const t = e.target;
      if (!t) continue;
      if (t.kind === "port") {
        // R6: fibre-end joint polish vs port connector polish
        const spec = graph.nodes.get(t.node)?.ports[t.port];
        const pj = jointModel(catalog, spec?.connector);
        const fj = jointModel(catalog, e.joint?.id);
        if (!pj?.polish || !fj?.polish || isApc(pj.polish) === isApc(fj.polish)) continue;
        out.push({
          severity: "error",
          code: "joint.polish_mismatch",
          element: f.id,
          port: end,
          message: `${f.id}.${end}: ${fj.id} (${fj.polish}) mated with port ${t.node}.${t.port} (${pj.id}, ${pj.polish}); APC must not mate with non-APC`,
          values: { joint: fj.id, joint_polish: fj.polish, node: t.node, node_port: t.port, port_connector: pj.id, port_polish: pj.polish },
        });
        continue;
      }
      // R7: fibre ↔ fibre junction
      const j = junctionName(f.id, end, t.fibre, t.end);
      if (done.has(j)) continue;
      done.add(j);
      const o = graph.fibres.get(t.fibre);
      const ta = f.type;
      const tb = o?.type;
      if (!ta || !tb) continue;
      const where = j.slice(6);
      const values = { other: `${t.fibre}.${t.end}`, type: ta.id, other_type: tb.id };
      const base = { element: f.id, port: end };
      if (isMultimode(ta) !== isMultimode(tb)) {
        out.push({
          severity: "error",
          code: "fibre.mode_mismatch",
          ...base,
          message: `${where}: ${isMultimode(ta) ? "multimode" : "single-mode"} ${ta.id} joined to ${isMultimode(tb) ? "multimode" : "single-mode"} ${tb.id}`,
          values,
        });
      } else if (isMultimode(ta)) {
        if (ta.core_um !== undefined && tb.core_um !== undefined && ta.core_um !== tb.core_um)
          out.push({
            severity: "warn",
            code: "fibre.core_mismatch",
            ...base,
            message: `${where}: multimode core ${ta.core_um} µm (${ta.id}) joined to ${tb.core_um} µm (${tb.id})`,
            values: { ...values, core_um: ta.core_um, other_core_um: tb.core_um },
          });
      } else if (ta.standard !== undefined && tb.standard !== undefined && normStandard(ta.standard) !== normStandard(tb.standard)) {
        out.push({
          severity: "info",
          code: "fibre.type_mismatch",
          ...base,
          message: `${where}: ${ta.standard} joined to ${tb.standard} (mode-field mismatch: extra splice loss, OTDR gainers)`,
          values: { ...values, standard: ta.standard, other_standard: tb.standard },
        });
      }
    }
  }
  return out;
}
