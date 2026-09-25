// WAVE-2: replace with import from "@optiplanner/engine" (done by editing ./impl.ts only).
// Every physics call in the app goes through this module; nothing else may compute power or CD.
import { engineImpl } from "./impl";
import type { EngineApi } from "./contract";

const api: EngineApi = engineImpl;

export const resolveCatalog: EngineApi["resolveCatalog"] = (entries) => api.resolveCatalog(entries);
export const portsOf: EngineApi["portsOf"] = (model, catalog) => api.portsOf(model, catalog);
export const validate: EngineApi["validate"] = (model, catalog) => api.validate(model, catalog);
export const compute: EngineApi["compute"] = (model, catalog, opts) => api.compute(model, catalog, opts);
export const toPortsCsv: EngineApi["toPortsCsv"] = (results, delimiter) => api.toPortsCsv(results, delimiter);
export const toSignalsCsv: EngineApi["toSignalsCsv"] = (results, delimiter) => api.toSignalsCsv(results, delimiter);
export const toMarkdown: EngineApi["toMarkdown"] = (model, results) => api.toMarkdown(model, results);

export type { Catalog, ComputeOptions } from "./contract";
