/** Shared by the worker and the in-thread fallback (tests / no Worker support). */
import { resolveCatalog, compute, type Catalog } from "../adapters/engine";
import type { Issue } from "@optiplanner/schema";
import type { ComputeRequest, ComputeResponse } from "./protocol";

let cached: { version: number; catalog: Catalog; issues: Issue[] } | null = null;

export function runCompute(req: ComputeRequest): ComputeResponse {
  const t0 = performance.now();
  try {
    if (!cached || cached.version !== req.catalogVersion) {
      const { catalog, issues } = resolveCatalog(req.catalogEntries);
      cached = { version: req.catalogVersion, catalog, issues };
    }
    const results = compute(req.model, cached.catalog, req.opts);
    return { reqId: req.reqId, ok: true, results, catalogIssues: cached.issues, ms: performance.now() - t0 };
  } catch (e) {
    return { reqId: req.reqId, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
