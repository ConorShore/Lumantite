import { create } from "zustand";
import type { Severity } from "@lumantite/schema";

export type Tab = "canvas" | "yaml" | "catalog" | "margins" | "results" | "exports";
export const TABS: { id: Tab; label: string }[] = [
  { id: "canvas", label: "Canvas" },
  { id: "yaml", label: "YAML" },
  { id: "catalog", label: "Catalog" },
  { id: "margins", label: "Margins" },
  { id: "results", label: "Results" },
  { id: "exports", label: "Exports" },
];
export type SelKind = "node" | "fibre" | "site" | "file";
export interface SelItem { kind: SelKind; id: string }
export interface ChannelFilter { plan: string; channel: string }

interface UiState {
  tab: Tab;
  selection: SelItem[];
  channelFilter: ChannelFilter | null;
  showFileFrames: boolean;
  severity: Record<Severity, boolean>;
  yamlFile: string | null;
  catalogKind: string;
  catalogSelected: string | null;
  /** Nodes whose full port list is shown (mux channel ports are collapsed by default). */
  expandedNodes: Record<string, boolean>;
  /** Bumped to ask the canvas to centre on the current selection. */
  focusRev: number;
  toast: { text: string; kind: "info" | "error" } | null;

  setTab(tab: Tab): void;
  select(items: SelItem[]): void;
  clearSelection(): void;
  setChannelFilter(f: ChannelFilter | null): void;
  toggleFileFrames(): void;
  toggleSeverity(s: Severity): void;
  setYamlFile(p: string | null): void;
  setCatalogView(kind: string, id?: string | null): void;
  toggleExpanded(id: string): void;
  focusSelection(): void;
  showToast(text: string, kind?: "info" | "error"): void;
}

export const useUi = create<UiState>()((set) => ({
  tab: "canvas",
  selection: [],
  channelFilter: null,
  showFileFrames: true,
  severity: { error: true, warn: true, info: true },
  yamlFile: null,
  catalogKind: "transceiver",
  catalogSelected: null,
  expandedNodes: {},
  focusRev: 0,
  toast: null,

  setTab: (tab) => set({ tab }),
  select: (selection) => set({ selection }),
  clearSelection: () => set({ selection: [] }),
  setChannelFilter: (channelFilter) => set({ channelFilter }),
  toggleFileFrames: () => set((s) => ({ showFileFrames: !s.showFileFrames })),
  toggleSeverity: (sev) => set((s) => ({ severity: { ...s.severity, [sev]: !s.severity[sev] } })),
  setYamlFile: (yamlFile) => set({ yamlFile }),
  setCatalogView: (catalogKind, id) => set((s) => ({ catalogKind, catalogSelected: id === undefined ? s.catalogSelected : id })),
  toggleExpanded: (id) => set((s) => ({ expandedNodes: { ...s.expandedNodes, [id]: !s.expandedNodes[id] } })),
  focusSelection: () => set((s) => ({ focusRev: s.focusRev + 1 })),
  showToast: (text, kind = "info") => set({ toast: { text, kind } }),
}));

export const isSelected = (sel: SelItem[], kind: SelKind, id: string) => sel.some((s) => s.kind === kind && s.id === id);
