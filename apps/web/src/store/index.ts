import { useProject } from "./projectStore";
import { useCatalog } from "./catalogStore";
import { useConfig } from "./configStore";
import { useResults } from "./resultsStore";
import { useUi } from "./uiStore";

export { useProject, useCatalog, useConfig, useResults, useUi };

let wired = false;
/** Recompute (debounced 150 ms) after any physics-relevant project, catalog or config change. */
export function wireStores(): void {
  if (wired) return;
  wired = true;
  useProject.subscribe((s, prev) => {
    if (s.projectId !== prev.projectId) {
      useResults.getState().clear();
      useUi.getState().clearSelection();
      useUi.getState().setYamlFile(null);
    }
    if (s.computeRev !== prev.computeRev) useResults.getState().requestRecompute();
    if (s.opIssues !== prev.opIssues && s.opIssues.length)
      useUi.getState().showToast(s.opIssues.map((i) => i.message).join("; "), "error");
  });
  useCatalog.subscribe((s, prev) => {
    if (s.version !== prev.version) useResults.getState().requestRecompute();
  });
  useConfig.subscribe((s, prev) => {
    if (s.config !== prev.config) useResults.getState().requestRecompute();
  });
}
wireStores();
