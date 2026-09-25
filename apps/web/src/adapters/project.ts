// WAVE-2: replace with import from "@optiplanner/project" (done by editing ./impl.ts only).
// Every YAML read/write in the app goes through this module; nothing else may import `yaml`.
import { projectImpl } from "./impl";
import type { ProjectApi } from "./contract";

const api: ProjectApi = projectImpl;

export const openProject: ProjectApi["openProject"] = (rootFile, files) => api.openProject(rootFile, files);
export const newProjectText: ProjectApi["newProjectText"] = (name) => api.newProjectText(name);
export const openCatalog: ProjectApi["openCatalog"] = (files) => api.openCatalog(files);

export type { Op, ProjectSession, CatalogSession, NewFibre } from "./contract";
