# Package contract

Read this with SPEC.md. This file fixes the public API of each package so they can be built in
parallel. Types named here live in `@optiplanner/schema` (packages/schema/src) unless stated.
If you must change a signature, change it here in the same commit and say so in your report.

Workspace: npm workspaces, TypeScript, ESM (`"type": "module"`, NodeNext, import paths end in `.js`).
Build: `npm run build -w <pkg>`. Test: vitest. Node ≥ 22. Do not run `git commit`.

```
packages/schema    @optiplanner/schema    zod schemas + TS types (done)
packages/engine    @optiplanner/engine    pure physics/propagation/checks/exports; no I/O, no DOM
packages/project   @optiplanner/project   YAML round-trip sessions for projects and catalog (pure, string in/out)
packages/catalog   @optiplanner/catalog   starter catalog YAML + wavelength plans (data only) + examples/
apps/server        @optiplanner/server    Fastify file API + static hosting
apps/cli           @optiplanner/cli       `optiplanner check|export`
apps/web           @optiplanner/web       React + Vite SPA
```

## @optiplanner/engine

```ts
import type { DeviceModel, WavelengthPlan, Channel, PortSpec, ProjectModel, Margins,
              Results, Issue, Triple, WlSpec, FibreModel } from "@optiplanner/schema";

export interface Catalog {
  models: Map<string, DeviceModel>;          // fully resolved (extends applied, validated)
  plans: Map<string, WavelengthPlan>;
  channel(plan: string, id: string): Channel | undefined;   // wavelength_nm + frequency_GHz always filled
  channels(plan: string): Channel[];
}
/** Deep-merge `extends` chains (child wins), validate each with DeviceModel/WavelengthPlan. Invalid entries are dropped and reported. */
export function resolveCatalog(entries: unknown[]): { catalog: Catalog; issues: Issue[] };

/** Effective port map of a model incl. generated ports (mux channel ports, splitter outN, passthrough paths), defaults applied. */
export function portsOf(model: DeviceModel, catalog: Catalog): Record<string, PortSpec>;

export interface ComputeOptions {
  defaultMargins?: Margins;      // from app config; project.margins override per key; DEFAULT_MARGINS fill the rest
  warnThreshold_dB?: number;     // default 1.0: pass margin below this → "warn"
}
/** Static validation only (ids, endpoints, families, models, settings). Fast; used on every keystroke. */
export function validate(model: ProjectModel, catalog: Catalog): Issue[];
/** Full computation. Never throws on bad input: returns issues instead. */
export function compute(model: ProjectModel, catalog: Catalog, opts?: ComputeOptions): Results;

export function toPortsCsv(results: Results, delimiter?: string): string;
export function toSignalsCsv(results: Results, delimiter?: string): string;
export function toMarkdown(model: ProjectModel, results: Results): string;

// physics helpers (also used by tests and the UI)
export function dbmToMw(dbm: number): number;
export function mwToDbm(mw: number): number;
export function sumDbm(values: number[]): number;                 // 10·log10(Σ 10^(v/10)); -Infinity for []
export function resolveTriple(spec: WlSpec, nm?: number): Triple; // scalar/Range3/table → {min,typ,max}; fills gaps
export function interp(table: { nm: number; value: number }[], nm: number): number; // linear, clamps + flag via separate fn
export function attenuationAt(fibre: FibreModel, nm: number): Triple;   // dB/km
export function dispersionAt(fibre: FibreModel, nm: number): number;    // ps/(nm·km)
```

Semantics are SPEC §7. Signal id = `${txNode}.${txPort}:${channelId}`. Fibre-to-fibre joints appear in
`PathStep.element` as `joint:<fibreA>.<end>~<fibreB>.<end>` with the lexically smaller fibre first.

## @optiplanner/project

Pure string-in / string-out. Uses the `yaml` package **Document API** so comments, key order and
formatting of untouched content survive. Never `YAML.stringify` a plain object over an existing file.

```ts
import type { ProjectModel, NodeInst, FibreInst, Site, Margins, ProjectMeta, Layout, Issue, XY, Rect } from "@optiplanner/schema";

export type Op =
  | { op: "addNode";    file: string; node: NodeInst; position?: XY }
  | { op: "updateNode"; id: string; patch: Partial<NodeInst> }          // key: undefined → delete key
  | { op: "deleteNode"; id: string }                                      // also detaches fibre ends pointing at it
  | { op: "addFibre";   file: string; fibre: NewFibre }   // FibreInst with optional a/b
  | { op: "updateFibre"; id: string; patch: Partial<FibreInst> }        // a/b patches are merged one level deep
  | { op: "deleteFibre"; id: string }                                     // also clears the far end's `to` if it pointed here
  | { op: "addSite";    file: string; site: Site; rect?: Rect }
  | { op: "updateSite"; id: string; patch: Partial<Site> }
  | { op: "deleteSite"; id: string }                                      // nodes keep running; their `site` key is removed
  | { op: "renameId";   kind: "node" | "fibre" | "site"; from: string; to: string } // rewrites every reference
  | { op: "moveToFile"; kind: "node" | "fibre" | "site"; id: string; file: string } // moves the YAML node incl. its comments + layout entry
  | { op: "setLayout";  kind: "node" | "site" | "file"; id: string; rect: XY | Rect }
  | { op: "setMargins"; margins: Margins }                                // parent file only
  | { op: "setProjectMeta"; patch: Partial<ProjectMeta> }
  | { op: "addFile";    file: string; label?: string }                    // creates an empty fragment + includes entry
  | { op: "removeFile"; file: string };                                   // refuses (issue) if the file still holds elements

export interface ProjectSession {
  readonly rootFile: string;
  readonly model: ProjectModel;                 // rebuilt after every mutation; treat as immutable snapshot
  readonly issues: Issue[];                     // parse + schema issues per file (code "project.*"), element = file path
  apply(ops: Op[]): Issue[];                    // applies atomically; returns issues from this batch
  setFileText(path: string, text: string): Issue[];   // YAML editor path: re-parse one file, keep others
  getFileText(path: string): string;            // current serialised text (parent or fragment)
  files(): string[];
  changedFiles(): string[];                     // since open() or last markSaved()
  serialize(): Record<string, string>;          // path → text, all files
  markSaved(paths?: string[]): void;
}
/** `files[rootFile]` is the parent. Include paths are resolved relative to the parent's directory. Missing includes → issue, project still opens. */
export function openProject(rootFile: string, files: Record<string, string>): ProjectSession;
/** A new empty project text (parent only). */
export function newProjectText(name: string): string;

export interface CatalogSession {
  readonly entries: { file: string; entry: unknown; index: number }[];   // raw (loose) entries in file order
  readonly issues: Issue[];
  upsert(file: string, entry: { kind: string; id: string } & Record<string, unknown>): void; // replace by id (any file) or append to `file`
  remove(id: string): void;
  getFileText(path: string): string;
  setFileText(path: string, text: string): Issue[];
  changedFiles(): string[];
  serialize(): Record<string, string>;
  markSaved(paths?: string[]): void;
}
/** Catalog files are either a top-level YAML sequence or multi-document (`---`) streams of entries. */
export function openCatalog(files: Record<string, string>): CatalogSession;
```

Conventions (as implemented):
- `XY`, `Rect`, `NewFibre` types are exported by `@optiplanner/project` (schema only exports the zod values).
- Two path forms: *storage paths* (keys of the `files` map, e.g. `metro/sites/a.yaml`) are used by
  `files()`, `changedFiles()`, `serialize()`, `markSaved()` and as `Issue.element` for file issues;
  *model paths* (`rootFile` for the parent, the include path as written, normalised, for fragments) are
  used in `model.files`, `element.file`, and `layout.files` keys. Op `file` arguments and
  `getFileText`/`setFileText` accept either form. They coincide when the parent is at the top level.
- Issue codes from sessions: `project.parse_error` (YAML syntax, also for catalog files),
  `project.schema_error` (zod validation of a file; message = `path: zodPath: message`),
  `project.file_unknown` (missing include / unknown file), `project.duplicate_id`,
  `project.invalid_op` (an op's precondition failed: unknown id, non-empty `removeFile`, …),
  `catalog.invalid_model` (catalog entry without `kind`/`id`).
- A file with YAML syntax errors keeps its last good content in the model; ops touching it are refused.
- A missing include is listed in `files()` with text `""` and left out of `serialize()` until an op writes to it.

## @optiplanner/catalog

Data only. `catalog/*.yaml` per SPEC §8.2, `examples/<name>/project.yaml` (+ fragments) that parse
with `@optiplanner/schema` and exercise the features. Exports nothing at runtime except
`catalogDir` and `examplesDir` (absolute paths) from `src/index.ts` for the server and tests.

## @optiplanner/server (HTTP API)

All JSON. Paths are relative to `paths.projects` / `paths.catalog`. `etag` = sha1 of file text.

```
GET  /api/config                        → AppConfig (resolved, with defaults)
GET  /api/projects                      → [{ id, name, rootFile }]           id = rootFile path; name from project.name
GET  /api/projects/:id(*)               → { rootFile, files: { [path]: { text, etag } } }   parent + every include (recursively read once)
PUT  /api/projects/:id(*)/files         ← { files: { [path]: { text, etag?: string | null } } }   etag null = new file
                                        → 200 { files: { [path]: { etag } } } | 409 { conflicts: [path], files: {...current} }
POST /api/projects                      ← { rootFile, name }                → creates from newProjectText
GET  /api/catalog                       → { files: { [path]: { text, etag } } }     shared catalog dir
PUT  /api/catalog/files                 ← same shape as project files PUT
GET  /api/projects/:id(*)/catalog       → project-local catalog files (dir `catalog/` beside the parent), may be empty
PUT  /api/projects/:id(*)/catalog/files
DELETE /api/projects/:id(*)/files?path=<relative>   deletes one project fragment file (path relative to `paths.projects`)
DELETE /api/catalog/files?path=<relative>           deletes one shared catalog file (path relative to `paths.catalog`)
GET  /*                                 → static SPA from apps/web/dist (history fallback to index.html)
```
Path traversal outside the configured dirs must be rejected (400). Config file path from
`OPTIPLANNER_CONFIG` env (default `/config.yaml`, falling back to `./config.yaml`).

The two DELETE routes remove one file inside the configured base directory, guarded the same way
reads/writes are: 400 if `path` escapes the base dir, 404 if it does not exist. Both refuse (409)
to delete a project parent file (a YAML whose top level has `optiplanner: 1`) — a parent file's
lifecycle is the project's, not a single fragment's.

## @optiplanner/web

- Vite + React 19 + TypeScript, `@xyflow/react` for the canvas, `@monaco-editor/react` for YAML,
  `zustand` for state, Tailwind v4 for styling.
- Loads project + catalog via the server API, opens them with `@optiplanner/project`, runs
  `resolveCatalog` + `compute` in a **web worker** (`src/worker/compute.worker.ts`), debounced 150 ms.
- Save = `PUT` of `session.changedFiles()` with their etags; on 409 show reload/overwrite. A
  fragment removed via the `removeFile` op is queued (by storage path) and `DELETE`d from the
  server on the next successful save; a failed delete stays queued and is retried on the next
  save, surfaced via the error toast.
- Tabs per SPEC §9: Canvas, YAML, Catalog, Margins, Results, Exports. Issues panel at the bottom.

## Shared conventions

- Issue codes: use `IssueCode` from schema; add new codes there if unavoidable.
- Never throw across a package boundary for user-data problems; return `Issue[]`.
- Numbers: dB to 2 decimals in UI/exports; keep full precision internally.
- Tests: `packages/*/test/**/*.test.ts` with vitest; physics tests must show the arithmetic in a comment.
