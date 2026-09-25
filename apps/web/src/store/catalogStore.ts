import { create } from "zustand";
import type { Issue } from "@optiplanner/schema";
import { openCatalog, type CatalogSession } from "../adapters/project";
import { resolveCatalog, type Catalog } from "../adapters/engine";
import { api, type FileMap } from "../api/client";
import { SAMPLE_CATALOG_FILES } from "../sample";

export type CatalogSource = "server" | "sample";
export type RawEntry = { kind: string; id: string } & Record<string, unknown>;
export interface CatalogRow { file: string; entry: RawEntry; local: boolean }

interface CatalogState {
  source: CatalogSource | null;
  session: CatalogSession | null;
  localSession: CatalogSession | null;
  etags: Record<string, string | null>;
  /** Shared entries then project-local ones (local overrides shared by id at resolve time). */
  rows: CatalogRow[];
  catalog: Catalog;
  issues: Issue[];
  version: number;
  dirtyFiles: string[];
  saving: boolean;
  error: string | null;

  load(): Promise<void>;
  openFiles(files: Record<string, string>, etags: Record<string, string | null>, source: CatalogSource): void;
  setLocal(files: Record<string, string>): void;
  upsert(file: string, entry: RawEntry): void;
  remove(id: string): void;
  save(): Promise<void>;
}

const EMPTY = resolveCatalog([]).catalog;
const isEntry = (e: unknown): e is RawEntry =>
  typeof e === "object" && e !== null && typeof (e as RawEntry).kind === "string" && typeof (e as RawEntry).id === "string";

export const useCatalog = create<CatalogState>()((set, get) => {
  /** Re-derive rows / resolved catalog after any session change. */
  const sync = () => {
    const { session, localSession } = get();
    const rows: CatalogRow[] = [];
    for (const e of session?.entries ?? []) if (isEntry(e.entry)) rows.push({ file: e.file, entry: e.entry, local: false });
    for (const e of localSession?.entries ?? []) if (isEntry(e.entry)) rows.push({ file: e.file, entry: e.entry, local: true });
    const { catalog, issues } = resolveCatalog(rows.map((r) => r.entry));
    set((s) => ({
      rows, catalog,
      issues: [...(session?.issues ?? []), ...(localSession?.issues ?? []), ...issues],
      version: s.version + 1,
      dirtyFiles: session?.changedFiles() ?? [],
    }));
  };

  return {
    source: null,
    session: null,
    localSession: null,
    etags: {},
    rows: [],
    catalog: EMPTY,
    issues: [],
    version: 0,
    dirtyFiles: [],
    saving: false,
    error: null,

    async load() {
      try {
        const { files } = await api.getCatalog();
        get().openFiles(texts(files), etagsOf(files), "server");
      } catch {
        get().openFiles(SAMPLE_CATALOG_FILES, {}, "sample");
      }
    },
    openFiles(files, etags, source) {
      set({ session: openCatalog(files), etags, source, error: null });
      sync();
    },
    setLocal(files) {
      set({ localSession: Object.keys(files).length ? openCatalog(files) : null });
      sync();
    },
    upsert(file, entry) {
      get().session?.upsert(file, entry);
      sync();
    },
    remove(id) {
      get().session?.remove(id);
      sync();
    },
    async save() {
      const { session, source, etags } = get();
      if (!session) return;
      const changed = session.changedFiles();
      if (!changed.length) return;
      if (source !== "server") { session.markSaved(changed); sync(); return; }
      set({ saving: true, error: null });
      try {
        const body = Object.fromEntries(changed.map((p) => [p, { text: session.getFileText(p), etag: etags[p] ?? null }]));
        const res = await api.putCatalogFiles(body);
        if (!res.ok) {
          set({ error: `Catalog changed on disk: ${res.conflicts.join(", ")}. Reload the page to pick up the new version.` });
          return;
        }
        session.markSaved(changed);
        set((s) => ({ etags: { ...s.etags, ...Object.fromEntries(Object.entries(res.files).map(([p, v]) => [p, v.etag])) } }));
        sync();
      } catch (e) {
        set({ error: (e as Error).message });
      } finally {
        set({ saving: false });
      }
    },
  };
});

export const texts = (files: FileMap) => Object.fromEntries(Object.entries(files).map(([p, f]) => [p, f.text]));
export const etagsOf = (files: FileMap) => Object.fromEntries(Object.entries(files).map(([p, f]) => [p, f.etag]));
