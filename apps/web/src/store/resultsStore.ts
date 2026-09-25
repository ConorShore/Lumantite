import { create } from "zustand";
import type { Issue, Results } from "@lumantite/schema";
import { requestCompute } from "../worker/client";
import { useProject } from "./projectStore";
import { useCatalog } from "./catalogStore";
import { useConfig } from "./configStore";

export const RECOMPUTE_DEBOUNCE_MS = 150;

interface ResultsState {
  results: Results | null;
  computing: boolean;
  ms: number | null;
  error: string | null;
  workerCatalogIssues: Issue[];
  /** Debounced (150 ms) recompute from the current project / catalog / config. */
  requestRecompute(): void;
  /** Immediate recompute; resolves when results are in. */
  recomputeNow(): Promise<void>;
  clear(): void;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let reqSeq = 0;

export const useResults = create<ResultsState>()((set, get) => ({
  results: null,
  computing: false,
  ms: null,
  error: null,
  workerCatalogIssues: [],

  requestRecompute() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void get().recomputeNow(); }, RECOMPUTE_DEBOUNCE_MS);
  },

  async recomputeNow() {
    if (timer) { clearTimeout(timer); timer = null; }
    const { model } = useProject.getState();
    if (!model) { set({ results: null }); return; }
    const { rows, version } = useCatalog.getState();
    const { config } = useConfig.getState();
    const reqId = ++reqSeq;
    set({ computing: true });
    const res = await requestCompute({
      reqId, model, catalogEntries: rows.map((r) => r.entry), catalogVersion: version,
      opts: { defaultMargins: config.defaults.margins, warnThreshold_dB: config.ui.warn_threshold_dB },
    });
    if (reqId !== reqSeq) return; // stale
    if (res.ok) set({ results: res.results, ms: res.ms, error: null, computing: false, workerCatalogIssues: res.catalogIssues });
    else set({ error: res.error, computing: false });
  },

  clear() { set({ results: null, error: null }); },
}));
