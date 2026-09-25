import { create } from "zustand";
import type { Issue, ProjectModel } from "@optiplanner/schema";
import { openProject, newProjectText, type Op, type ProjectSession } from "../adapters/project";
import { api, type FileMap, type ProjectListItem } from "../api/client";
import { SAMPLE_PROJECT_FILES, SAMPLE_ROOT } from "../sample";
import { useCatalog, texts, etagsOf } from "./catalogStore";
import { storageOf } from "../lib/paths";

export type Source = "server" | "sample";

export interface Conflict { paths: string[]; files: FileMap }

interface ProjectState {
  source: Source | null;
  projects: ProjectListItem[];
  projectId: string | null;
  session: ProjectSession | null;
  model: ProjectModel | null;
  sessionIssues: Issue[];
  /** Issues returned by the last rejected op batch (shown as a toast). */
  opIssues: Issue[];
  /** Keyed by model path (model.files[].path). */
  fileTexts: Record<string, string>;
  /** Storage paths (session.changedFiles()); used for save. */
  dirtyFiles: string[];
  /** Same, as model paths, for UI markers. */
  dirtyModel: string[];
  etags: Record<string, string | null>;
  /** Bumped on every change that affects physics (i.e. not layout-only). */
  computeRev: number;
  saving: boolean;
  conflict: Conflict | null;
  error: string | null;

  loadProjects(): Promise<void>;
  open(id: string): Promise<void>;
  openFromFiles(rootFile: string, files: Record<string, string>, etags: Record<string, string | null>, source: Source): void;
  applyOps(ops: Op[]): Issue[];
  setFileText(path: string, text: string): Issue[];
  save(): Promise<void>;
  resolveConflict(mode: "reload" | "overwrite" | "cancel"): Promise<void>;
  createProject(name: string): Promise<void>;
}

const LAYOUT_ONLY = new Set<Op["op"]>(["setLayout"]);
const LAST_KEY = "optiplanner.lastProject";
const remember = (id: string) => { try { localStorage.setItem(LAST_KEY, id); } catch { /* private mode */ } };
export const lastProject = (): string | null => { try { return localStorage.getItem(LAST_KEY); } catch { return null; } };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";

export const useProject = create<ProjectState>()((set, get) => {
  /** Copy session state into the store. Keeps string identity of unchanged file texts. */
  const sync = (physics: boolean) => {
    const { session, fileTexts } = get();
    if (!session) return;
    const model = session.model;
    const next: Record<string, string> = {};
    for (const { path } of model.files) {
      const t = session.getFileText(path);
      next[path] = fileTexts[path] === t ? fileTexts[path]! : t;
    }
    const dirty = session.changedFiles();
    set((s) => ({
      model,
      sessionIssues: session.issues,
      fileTexts: next,
      dirtyFiles: dirty,
      dirtyModel: model.files.map((f) => f.path).filter((p) => dirty.includes(storageOf(model.rootFile, p))),
      computeRev: physics ? s.computeRev + 1 : s.computeRev,
    }));
  };

  return {
    source: null,
    projects: [],
    projectId: null,
    session: null,
    model: null,
    sessionIssues: [],
    opIssues: [],
    fileTexts: {},
    dirtyFiles: [],
    dirtyModel: [],
    etags: {},
    computeRev: 0,
    saving: false,
    conflict: null,
    error: null,

    async loadProjects() {
      try {
        const projects = await api.listProjects();
        set({ projects, source: "server", error: null });
      } catch {
        const name = /name:\s*(.+)/.exec(SAMPLE_PROJECT_FILES[SAMPLE_ROOT]!)?.[1]?.trim() ?? "Sample";
        set((s) => ({
          source: "sample",
          projects: s.source === "sample" ? s.projects : [{ id: SAMPLE_ROOT, name, rootFile: SAMPLE_ROOT }],
        }));
      }
    },

    async open(id) {
      const { source } = get();
      if (source === "sample") {
        if (id === SAMPLE_ROOT) get().openFromFiles(SAMPLE_ROOT, SAMPLE_PROJECT_FILES, {}, "sample");
        return;
      }
      try {
        const p = await api.getProject(id);
        get().openFromFiles(p.rootFile, texts(p.files), etagsOf(p.files), "server");
        set({ projectId: id });
        remember(id);
        api.getProjectCatalog(id)
          .then((c) => useCatalog.getState().setLocal(texts(c.files)))
          .catch(() => useCatalog.getState().setLocal({}));
      } catch (e) {
        set({ error: `Could not open ${id}: ${(e as Error).message}` });
      }
    },

    openFromFiles(rootFile, files, etags, source) {
      const session = openProject(rootFile, files);
      set({ session, projectId: rootFile, etags, source, conflict: null, error: null, opIssues: [], fileTexts: {} });
      sync(true);
    },

    applyOps(ops) {
      const { session } = get();
      if (!session || !ops.length) return [];
      const issues = session.apply(ops);
      set({ opIssues: issues.filter((i) => i.severity === "error") });
      sync(ops.some((o) => !LAYOUT_ONLY.has(o.op)));
      return issues;
    },

    setFileText(path, text) {
      const { session } = get();
      if (!session) return [];
      if (session.getFileText(path) === text) return [];
      const issues = session.setFileText(path, text);
      sync(true);
      return issues;
    },

    async save() {
      const { session, source, etags, projectId } = get();
      if (!session || !projectId) return;
      const changed = session.changedFiles();
      if (!changed.length) return;
      if (source !== "server") { session.markSaved(changed); sync(false); return; }
      set({ saving: true, error: null });
      try {
        const body = Object.fromEntries(changed.map((p) => [p, { text: session.getFileText(p), etag: etags[p] ?? null }]));
        const res = await api.putProjectFiles(projectId, body);
        if (!res.ok) { set({ conflict: { paths: res.conflicts, files: res.files } }); return; }
        session.markSaved(changed);
        set((s) => ({ etags: { ...s.etags, ...Object.fromEntries(Object.entries(res.files).map(([p, v]) => [p, v.etag])) } }));
        sync(false);
      } catch (e) {
        set({ error: `Save failed: ${(e as Error).message}` });
      } finally {
        set({ saving: false });
      }
    },

    async resolveConflict(mode) {
      const { conflict, projectId } = get();
      if (!conflict || !projectId) return;
      if (mode === "cancel") { set({ conflict: null }); return; }
      if (mode === "reload") { set({ conflict: null }); await get().open(projectId); return; }
      // overwrite: adopt the server's current etags for the conflicting files, then save again
      set((s) => ({
        conflict: null,
        etags: { ...s.etags, ...Object.fromEntries(conflict.paths.map((p) => [p, conflict.files[p]?.etag ?? null])) },
      }));
      await get().save();
    },

    async createProject(name) {
      const rootFile = `${slug(name)}/project.yaml`;
      if (get().source === "sample") {
        set((s) => ({ projects: [...s.projects, { id: rootFile, name, rootFile }] }));
        get().openFromFiles(rootFile, { [rootFile]: newProjectText(name) }, { [rootFile]: null }, "sample");
        return;
      }
      try {
        await api.createProject(rootFile, name);
        await get().loadProjects();
        await get().open(rootFile);
      } catch (e) {
        set({ error: `Create failed: ${(e as Error).message}` });
      }
    },
  };
});
