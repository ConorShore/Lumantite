import type { Issue, ProjectModel } from "@lumantite/schema";
import { txChannel, type Catalog } from "./catalog.js";
import { buildGraph, type Graph } from "./graph.js";

/** Per-instance settings, sites, hosts, plans. */
export function validateSettings(model: ProjectModel, graph: Graph, catalog: Catalog): Issue[] {
  const issues: Issue[] = [];
  const siteIds = new Set<string>();
  for (const s of model.sites ?? []) {
    if (siteIds.has(s.id)) issues.push({ severity: "error", code: "project.duplicate_id", element: s.id, message: `Duplicate site id ${s.id}` });
    siteIds.add(s.id);
  }
  for (const s of model.sites ?? []) {
    if (s.parent && !siteIds.has(s.parent))
      issues.push({ severity: "error", code: "project.unknown_site", element: s.id, message: `Site ${s.id}: unknown parent site ${s.parent}`, values: { site: s.parent } });
  }
  const files = new Set((model.files ?? []).map((f) => f.path));
  const checkFile = (id: string, file: string | undefined) => {
    if (file !== undefined && files.size > 0 && !files.has(file))
      issues.push({ severity: "warn", code: "project.file_unknown", element: id, message: `${id} belongs to ${file}, which is not a project file`, values: { file } });
  };
  for (const s of model.sites ?? []) checkFile(s.id, s.file);
  for (const f of model.fibres ?? []) checkFile(f.id, f.file);

  for (const p of model.project?.wavelength_plans ?? []) {
    if (!catalog.plans.has(p)) issues.push({ severity: "warn", code: "catalog.unknown_plan", element: model.rootFile, message: `Project uses unknown wavelength plan ${p}`, values: { plan: p } });
  }

  for (const n of graph.nodes.values()) {
    const inst = n.inst;
    checkFile(inst.id, inst.file);
    if (inst.site && !siteIds.has(inst.site))
      issues.push({ severity: "error", code: "project.unknown_site", element: inst.id, message: `${inst.id}: unknown site ${inst.site}`, values: { site: inst.site } });
    if (inst.host) {
      const h = graph.nodes.get(inst.host);
      if (!h || (h.model && h.model.kind !== "host"))
        issues.push({ severity: "error", code: "project.unknown_host", element: inst.id, message: `${inst.id}: unknown host ${inst.host}`, values: { host: inst.host } });
      else if (inst.slot && h.model?.kind === "host" && h.model.slots && !h.model.slots.includes(inst.slot))
        issues.push({ severity: "warn", code: "project.invalid_settings", element: inst.id, message: `${inst.id}: host ${inst.host} has no slot ${inst.slot}`, values: { slot: inst.slot } });
    }
    const m = n.model;
    if (!m) continue;
    const s = inst.settings ?? {};
    const bad = (msg: string, severity: "error" | "warn" = "error") =>
      issues.push({ severity, code: "project.invalid_settings", element: inst.id, message: `${inst.id}: ${msg}` });
    switch (m.kind) {
      case "transceiver": {
        const r = txChannel(m, s, catalog);
        if (r.error) bad(r.error);
        else if (s.channel !== undefined && "plan" in m.tx.wavelength && "channel" in m.tx.wavelength && s.channel !== m.tx.wavelength.channel)
          bad(`settings.channel ${s.channel} ignored: model is fixed to ${m.tx.wavelength.channel}`, "warn");
        break;
      }
      case "amplifier": {
        const mode = s.mode ?? m.modes[0];
        if (!m.modes.includes(mode))
          issues.push({ severity: "error", code: "amp.mode_unsupported", element: inst.id, message: `${inst.id}: mode ${mode} not supported by ${m.id} (${m.modes.join(", ")})`, values: { mode } });
        if (mode === "constant_gain" && s.gain_dB === undefined) bad(`constant_gain mode needs settings.gain_dB`);
        if (mode === "constant_output_power" && s.output_power_dBm === undefined) bad(`constant_output_power mode needs settings.output_power_dBm`);
        const gm = s.gain_model ?? m.gain_model ?? "parametric";
        if (gm === "measured" && !(m.gain_spectrum && m.gain_spectrum.length)) bad(`gain_model measured but ${m.id} has no gain_spectrum; parametric used`);
        break;
      }
      case "attenuator": {
        if (m.range_dB) {
          if (s.setting_dB === undefined) bad(`VOA needs settings.setting_dB (${m.range_dB.min}…${m.range_dB.max} dB)`);
          else if (s.setting_dB < m.range_dB.min || s.setting_dB > m.range_dB.max)
            bad(`setting_dB ${s.setting_dB} outside ${m.range_dB.min}…${m.range_dB.max} dB`);
        }
        break;
      }
      default:
        break;
    }
  }
  return issues;
}

/** Static validation only (ids, endpoints, families, models, settings). */
export function validate(model: ProjectModel, catalog: Catalog): Issue[] {
  const { graph, issues } = buildGraph(model, catalog);
  return [...issues, ...validateSettings(model, graph, catalog)];
}
