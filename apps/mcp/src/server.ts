/**
 * Lumantite MCP server: project checking, link budgets, catalog lookup, exports and
 * comment-preserving project edits, exposed as MCP tools.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Op } from "@lumantite/project";
import {
  catalogDirs, createProject, editProject, exportText, listExamples, loadCatalog, loadProject, run, summarize,
  type ExportFormat,
} from "./lumantite.js";

const DISCLAIMER = "Results are estimates provided without warranty; see DISCLAIMER.md.";

const project = z.string().describe("Path to the project's root YAML file (absolute, or relative to the server's working directory)");
const catalog = z.array(z.string()).optional()
  .describe("Catalog directories to use instead of the bundled starter catalog. <project dir>/catalog is always added.");

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function error(e: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }] };
}

/** Wrap a handler so thrown errors become tool errors instead of protocol errors. */
function tool<A>(fn: (args: A) => unknown) {
  return async (args: A) => {
    try { return json(await fn(args)); } catch (e) { return error(e); }
  };
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "lumantite", version: "0.1.0" },
    { instructions: `Lumantite optical network planner. Projects are YAML (root file + includes). Use check_project for pass/fail, get_signal for an element-by-element link budget, search_catalog for model ids, and edit_project to change a project (use dry_run first). ${DISCLAIMER}` },
  );

  server.registerTool("list_examples", {
    description: "List the bundled example projects and their root file paths.",
    inputSchema: {},
  }, tool(() => listExamples()));

  server.registerTool("check_project", {
    description: "Validate and compute a project: counts, pass/warn/fail summary, one line per signal (end power min/typ/max dBm, CD), amplifier operating points and all warnings/errors. ok=false means an error-severity issue exists.",
    inputSchema: { project, catalog },
  }, tool(({ project, catalog }: { project: string; catalog?: string[] }) => {
    const l = loadProject(project, catalog);
    return { ...summarize(l, run(l)), disclaimer: DISCLAIMER };
  }));

  server.registerTool("get_signal", {
    description: "Full link budget for one signal: every path element with loss/gain, cumulative power (min/typ/max) and dispersion, plus each check and its margin. Signal ids look like `<txNode>.<txPort>:<channel>` (see check_project).",
    inputSchema: { project, signal_id: z.string(), catalog },
  }, tool(({ project, signal_id, catalog }: { project: string; signal_id: string; catalog?: string[] }) => {
    const l = loadProject(project, catalog);
    const results = run(l);
    const sig = results.signals.find((s) => s.id === signal_id);
    if (sig) return sig;
    const near = results.signals.map((s) => s.id).filter((id) => id.includes(signal_id) || signal_id.includes(id.split(":")[0]!));
    throw new Error(`no signal ${signal_id}. ${near.length ? `Did you mean: ${near.slice(0, 10).join(", ")}` : `Signals: ${results.signals.map((s) => s.id).slice(0, 20).join(", ")}`}`);
  }));

  server.registerTool("get_results", {
    description: "Detailed computed results for ports, fibres, amplifiers (per-channel gain) or issues, optionally filtered to one element id.",
    inputSchema: {
      project,
      section: z.enum(["ports", "fibres", "amplifiers", "issues"]),
      element: z.string().optional().describe("Node or fibre id to filter by"),
      catalog,
    },
  }, tool(({ project, section, element, catalog }: { project: string; section: "ports" | "fibres" | "amplifiers" | "issues"; element?: string; catalog?: string[] }) => {
    const l = loadProject(project, catalog);
    const results = run(l);
    if (section === "ports") return results.ports.filter((p) => !element || p.node === element);
    if (section === "fibres") return results.fibres.filter((f) => !element || f.id === element);
    if (section === "amplifiers") return results.amplifiers.filter((a) => !element || a.id === element);
    return [...l.catalogIssues, ...l.session.issues, ...results.issues].filter((i) => !element || i.element === element);
  }));

  server.registerTool("get_project_model", {
    description: "The parsed project model: files, project metadata and margins, sites, nodes (with model ids and settings) and fibres (with endpoints), each tagged with the file it lives in.",
    inputSchema: { project, include_layout: z.boolean().optional().describe("Include canvas layout coordinates (default false)") },
  }, tool(({ project, include_layout }: { project: string; include_layout?: boolean }) => {
    const { session } = loadProject(project);
    const { layout, ...rest } = session.model;
    return include_layout ? session.model : rest;
  }));

  server.registerTool("search_catalog", {
    description: "Search catalog models (transceivers, fibres, joints, muxes, amplifiers, attenuators, DCMs, splitters, ...) and wavelength plans. Returns id, kind and descriptive fields.",
    inputSchema: {
      query: z.string().optional().describe("Case-insensitive substring matched against id, vendor, model and description"),
      kind: z.string().optional().describe("Model kind, e.g. transceiver, fibre, joint, mux, amplifier, attenuator, dcm, splitter, wavelength-plan"),
      project: project.optional().describe("Include this project's local catalog directory"),
      catalog,
    },
  }, tool(({ query, kind, project, catalog }: { query?: string; kind?: string; project?: string; catalog?: string[] }) => {
    const dir = project ? resolve(project, "..") : undefined;
    const { catalog: cat, issues } = loadCatalog(catalogDirs(dir, catalog));
    const q = query?.toLowerCase();
    const rows = [
      ...[...cat.models.values()].map((m) => ({ id: m.id, kind: m.kind as string, vendor: m.vendor, model: m.model, description: m.description })),
      ...[...cat.plans.values()].map((p) => ({ id: p.id, kind: "wavelength-plan", vendor: undefined, model: p.name, description: p.description, channels: p.channels.length })),
    ].filter((r) => (!kind || r.kind === kind)
      && (!q || [r.id, r.vendor, r.model, r.description].some((s) => s?.toLowerCase().includes(q))));
    return { models: rows, catalogIssues: issues };
  }));

  server.registerTool("get_catalog_model", {
    description: "Full resolved definition (after `extends`) of a catalog model or wavelength plan; for plans, the resolved channel list with frequencies and wavelengths.",
    inputSchema: { id: z.string(), project: project.optional().describe("Include this project's local catalog directory"), catalog },
  }, tool(({ id, project, catalog }: { id: string; project?: string; catalog?: string[] }) => {
    const dir = project ? resolve(project, "..") : undefined;
    const { catalog: cat } = loadCatalog(catalogDirs(dir, catalog));
    const model = cat.models.get(id);
    if (model) return model;
    if (cat.plans.has(id)) return { ...cat.plans.get(id), channels: cat.channels(id) };
    throw new Error(`no catalog model or plan with id ${id}`);
  }));

  server.registerTool("export_project", {
    description: "Compute a project and return a Markdown link-budget report or CSV (per port / per signal). If out_dir is given the file is also written there.",
    inputSchema: {
      project,
      format: z.enum(["md", "ports_csv", "signals_csv"]),
      out_dir: z.string().optional(),
      catalog,
    },
  }, tool(({ project, format, out_dir, catalog }: { project: string; format: ExportFormat; out_dir?: string; catalog?: string[] }) => {
    const l = loadProject(project, catalog);
    const { name, text } = exportText(l, run(l), format);
    if (!out_dir) return { name, text };
    mkdirSync(resolve(out_dir), { recursive: true });
    const path = join(resolve(out_dir), name);
    writeFileSync(path, text);
    return { wrote: path };
  }));

  server.registerTool("edit_project", {
    description: `Apply edit operations atomically to a project and save only the changed YAML files (comments and ordering are preserved). All ops succeed or none are applied. Use dry_run to preview the resulting file text.
Ops (\`file\` is a path relative to the root file's directory; ids never contain '.'; fibre endpoints are \`{ to: "node.port" }\`):
- { op: "addNode", file, node: { id, model, site?, name?, settings? } }
- { op: "updateNode", id, patch }            - { op: "deleteNode", id }
- { op: "addFibre", file, fibre: { id, type, length_km, a: { to }, b: { to } } }
- { op: "updateFibre", id, patch }           - { op: "deleteFibre", id }
- { op: "addSite", file, site: { id, name? } } - { op: "updateSite", id, patch } - { op: "deleteSite", id }
- { op: "renameId", kind: "node"|"fibre"|"site", from, to }
- { op: "moveToFile", kind, id, file }
- { op: "setMargins", margins }              - { op: "setProjectMeta", patch }
- { op: "addFile", file, label? }            - { op: "removeFile", file } (drops the include; does not delete the file)
Use get_project_model to see existing shapes and search_catalog for model and fibre-type ids.`,
    inputSchema: {
      project,
      ops: z.array(z.object({ op: z.string() }).passthrough()).min(1),
      dry_run: z.boolean().optional().describe("Preview only; nothing is written (default false)"),
      recompute: z.boolean().optional().describe("Return a check_project summary after the edit (default true)"),
      catalog,
    },
  }, tool(({ project, ops, dry_run, recompute, catalog }: { project: string; ops: { op: string }[]; dry_run?: boolean; recompute?: boolean; catalog?: string[] }) => {
    const l = loadProject(project, catalog);
    const res = editProject(l, ops as unknown as Op[], dry_run ?? false);
    if (!res.applied) return { applied: false, issues: res.issues };
    const out: Record<string, unknown> = {
      applied: true,
      dry_run: dry_run ?? false,
      files: dry_run ? res.changed : Object.keys(res.changed),
      issues: res.issues,
    };
    if (recompute ?? true) {
      const { summary, ok, issues } = summarize(l, run(l));
      out.after = { summary, ok, issues };
    }
    return out;
  }));

  server.registerTool("create_project", {
    description: "Create a new, empty single-file project at the given path (refuses to overwrite).",
    inputSchema: { path: z.string().describe("Path of the new root YAML file, e.g. projects/metro/project.yaml"), name: z.string() },
  }, tool(({ path, name }: { path: string; name: string }) => ({ created: createProject(path, name) })));

  return server;
}
