import { lazy, Suspense, useEffect, useState } from "react";
import "./store"; // wires recompute subscriptions
import { useUi, type Tab } from "./store/uiStore";
import { deleteSelection } from "./store/actions";
import { TopBar } from "./components/layout/TopBar";
import { Sidebar } from "./components/layout/Sidebar";
import { TabBar } from "./components/layout/TabBar";
import { IssuesPanel } from "./components/layout/IssuesPanel";
import { ConflictDialog } from "./components/layout/ConflictDialog";
import { Toast } from "./components/layout/Toast";
import { Inspector } from "./components/inspector/Inspector";
import { CanvasTab } from "./components/canvas/CanvasTab";
import { CatalogTab } from "./components/catalog/CatalogTab";
import { MarginsTab } from "./components/margins/MarginsTab";
import { ResultsTab } from "./components/results/ResultsTab";
import { ExportsTab } from "./components/exports/ExportsTab";
import { ErrorBoundary } from "./components/common/ErrorBoundary";

// Monaco is large: load it only when the YAML tab is first opened.
const YamlTab = lazy(() => import("./components/yaml/YamlTab"));

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || !!el.closest(".monaco-editor");
}

export function App() {
  const tab = useUi((s) => s.tab);
  // Canvas and YAML stay mounted once visited (viewport, editor state); others mount on demand.
  const [visited, setVisited] = useState<Record<Tab, boolean>>({ canvas: true } as Record<Tab, boolean>);
  useEffect(() => setVisited((v) => (v[tab] ? v : { ...v, [tab]: true })), [tab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.key === "Escape") useUi.getState().clearSelection();
      else if ((e.key === "Delete" || e.key === "Backspace") && useUi.getState().tab === "canvas") {
        e.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Hidden layers keep their size (React Flow / Monaco measure it); .tab-hidden forces visibility on descendants.
  const layer = (t: Tab) => `absolute inset-0 ${tab === t ? "" : "tab-hidden pointer-events-none"}`;
  return (
    <div className="h-full flex flex-col text-slate-900">
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0 border-x border-slate-200">
          <TabBar />
          <div className="relative flex-1 min-h-0 bg-white">
            <div className={layer("canvas")} data-testid="tab-canvas"><ErrorBoundary label="Canvas"><CanvasTab /></ErrorBoundary></div>
            {visited.yaml && (
              <div className={layer("yaml")}>
                <ErrorBoundary label="YAML editor"><Suspense fallback={<div className="p-4 text-slate-500">Loading editor…</div>}><YamlTab /></Suspense></ErrorBoundary>
              </div>
            )}
            {tab === "catalog" && <div className="absolute inset-0"><ErrorBoundary label="Catalog"><CatalogTab /></ErrorBoundary></div>}
            {tab === "margins" && <div className="absolute inset-0 overflow-auto"><ErrorBoundary label="Margins"><MarginsTab /></ErrorBoundary></div>}
            {tab === "results" && <div className="absolute inset-0"><ErrorBoundary label="Results"><ResultsTab /></ErrorBoundary></div>}
            {tab === "exports" && <div className="absolute inset-0"><ErrorBoundary label="Exports"><ExportsTab /></ErrorBoundary></div>}
          </div>
          <IssuesPanel />
        </main>
        <ErrorBoundary label="Inspector"><Inspector /></ErrorBoundary>
      </div>
      <ConflictDialog />
      <Toast />
    </div>
  );
}
