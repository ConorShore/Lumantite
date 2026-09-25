/** Cross-store actions. */
import type { Issue, ProjectModel } from "@optiplanner/schema";
import type { Op } from "../adapters/project";
import { api } from "../api/client";
import { useProject, lastProject } from "./projectStore";
import { useCatalog } from "./catalogStore";
import { useConfig } from "./configStore";
import { useUi, type SelItem } from "./uiStore";
import { signalTxNode } from "./selectors";
import { storageOf } from "../lib/paths";

export async function bootstrap(): Promise<void> {
  api.getConfig().then((c) => useConfig.getState().setConfig(c)).catch(() => { /* defaults */ });
  await Promise.all([useProject.getState().loadProjects(), useCatalog.getState().load()]);
  const { projects } = useProject.getState();
  const last = lastProject();
  const id = projects.find((p) => p.id === last)?.id ?? projects[0]?.id;
  if (id) await useProject.getState().open(id);
}

/** Map an issue's `element` to something selectable. */
export function elementForIssue(issue: Issue, model: ProjectModel | null): SelItem | null {
  const el = issue.element;
  if (!el || !model) return null;
  if (model.nodes.some((n) => n.id === el)) return { kind: "node", id: el };
  if (model.fibres.some((f) => f.id === el)) return { kind: "fibre", id: el };
  if (model.sites.some((s) => s.id === el)) return { kind: "site", id: el };
  const file = model.files.find((f) => f.path === el || storageOf(model.rootFile, f.path) === el);
  if (file) return { kind: "file", id: file.path };
  if (el.startsWith("joint:")) {
    const fibre = el.slice(6).split("~")[0]?.split(".")[0];
    return fibre ? { kind: "fibre", id: fibre } : null;
  }
  if (el.includes(":")) {
    const node = signalTxNode(el);
    return node ? { kind: "node", id: node } : null;
  }
  return null;
}

/** Issues panel click: select the element and show it on the canvas (files open in the YAML tab). */
export function selectIssue(issue: Issue): void {
  const item = elementForIssue(issue, useProject.getState().model);
  const ui = useUi.getState();
  if (!item) return;
  if (item.kind === "file") { ui.setYamlFile(item.id); ui.setTab("yaml"); return; }
  ui.select([item]);
  ui.setTab("canvas");
  ui.focusSelection();
}

export function deleteSelection(): void {
  const { selection } = useUi.getState();
  if (!selection.length) return;
  const ops: Op[] = [];
  for (const s of selection) {
    if (s.kind === "node") ops.push({ op: "deleteNode", id: s.id });
    else if (s.kind === "fibre") ops.push({ op: "deleteFibre", id: s.id });
    else if (s.kind === "site") ops.push({ op: "deleteSite", id: s.id });
    else if (s.kind === "file") ops.push({ op: "removeFile", file: s.id });
  }
  const issues = useProject.getState().applyOps(ops);
  if (!issues.some((i) => i.severity === "error")) useUi.getState().clearSelection();
}
