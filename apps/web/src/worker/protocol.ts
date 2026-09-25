import type { ProjectModel, Results, Issue } from "@lumantite/schema";
import type { ComputeOptions } from "../adapters/engine";

export interface ComputeRequest {
  reqId: number;
  model: ProjectModel;
  catalogEntries: unknown[];
  /** Bumped whenever catalogEntries change so the worker can cache the resolved catalog. */
  catalogVersion: number;
  opts: ComputeOptions;
}
export type ComputeResponse =
  | { reqId: number; ok: true; results: Results; catalogIssues: Issue[]; ms: number }
  | { reqId: number; ok: false; error: string };
