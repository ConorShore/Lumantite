/**
 * Verbatim copy of the public API in docs/CONTRACT.md (engine + project packages).
 *
 * The app only ever talks to these types. `engine.ts` / `project.ts` assert at compile time that
 * whatever `impl.ts` points at (the real packages) satisfies them, so a
 * signature drift in the real packages shows up as a type error in exactly one place.
 */
import type {
  DeviceModel, WavelengthPlan, Channel, PortSpec, ProjectModel, Margins, Results, Issue,
  NodeInst, FibreInst, Site, ProjectMeta,
} from "@optiplanner/schema";

// CONTRACT gap: @optiplanner/schema exports `XY` / `Rect` only as zod values, not as types.
export interface XY { x: number; y: number }
export interface Rect extends XY { w: number; h: number }
/** FibreInst with optional a/b (CONTRACT: exported by @optiplanner/project). */
export type NewFibre = Omit<FibreInst, "a" | "b"> & Partial<Pick<FibreInst, "a" | "b">>;

// ---------------------------------------------------------------- engine
export interface Catalog {
  models: Map<string, DeviceModel>;
  plans: Map<string, WavelengthPlan>;
  channel(plan: string, id: string): Channel | undefined;
  channels(plan: string): Channel[];
}

export interface ComputeOptions {
  defaultMargins?: Margins;
  warnThreshold_dB?: number;
}

export interface EngineApi {
  resolveCatalog(entries: unknown[]): { catalog: Catalog; issues: Issue[] };
  portsOf(model: DeviceModel, catalog: Catalog): Record<string, PortSpec>;
  validate(model: ProjectModel, catalog: Catalog): Issue[];
  compute(model: ProjectModel, catalog: Catalog, opts?: ComputeOptions): Results;
  toPortsCsv(results: Results, delimiter?: string): string;
  toSignalsCsv(results: Results, delimiter?: string): string;
  toMarkdown(model: ProjectModel, results: Results): string;
}

// ---------------------------------------------------------------- project
export type Op =
  | { op: "addNode"; file: string; node: NodeInst; position?: XY }
  | { op: "updateNode"; id: string; patch: Partial<NodeInst> }
  | { op: "deleteNode"; id: string }
  | { op: "addFibre"; file: string; fibre: NewFibre }
  | { op: "updateFibre"; id: string; patch: Partial<FibreInst> }
  | { op: "deleteFibre"; id: string }
  | { op: "addSite"; file: string; site: Site; rect?: Rect }
  | { op: "updateSite"; id: string; patch: Partial<Site> }
  | { op: "deleteSite"; id: string }
  | { op: "renameId"; kind: "node" | "fibre" | "site"; from: string; to: string }
  | { op: "moveToFile"; kind: "node" | "fibre" | "site"; id: string; file: string }
  | { op: "setLayout"; kind: "node" | "site" | "file"; id: string; rect: XY | Rect }
  | { op: "setMargins"; margins: Margins }
  | { op: "setProjectMeta"; patch: Partial<ProjectMeta> }
  | { op: "addFile"; file: string; label?: string }
  | { op: "removeFile"; file: string };

/**
 * Path forms (CONTRACT "Conventions"): *storage paths* (keys of the `files` map) are used by `files()`,
 * `changedFiles()`, `serialize()`, `markSaved()` and file-issue `element`s; *model paths* (rootFile for
 * the parent, the normalised include path for fragments) by `model.files`, `element.file` and
 * `layout.files`. Op `file` args and get/setFileText accept either.
 */
export interface ProjectSession {
  readonly rootFile: string;
  readonly model: ProjectModel;
  readonly issues: Issue[];
  apply(ops: Op[]): Issue[];
  setFileText(path: string, text: string): Issue[];
  getFileText(path: string): string;
  files(): string[];
  changedFiles(): string[];
  serialize(): Record<string, string>;
  markSaved(paths?: string[]): void;
}

export interface CatalogSession {
  readonly entries: { file: string; entry: unknown; index: number }[];
  readonly issues: Issue[];
  upsert(file: string, entry: { kind: string; id: string } & Record<string, unknown>): void;
  remove(id: string): void;
  getFileText(path: string): string;
  setFileText(path: string, text: string): Issue[];
  changedFiles(): string[];
  serialize(): Record<string, string>;
  markSaved(paths?: string[]): void;
}

export interface ProjectApi {
  openProject(rootFile: string, files: Record<string, string>): ProjectSession;
  newProjectText(name: string): string;
  openCatalog(files: Record<string, string>): CatalogSession;
}
