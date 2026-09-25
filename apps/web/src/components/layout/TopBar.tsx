import { useProject } from "../../store/projectStore";
import { useResults } from "../../store/resultsStore";
import { Count } from "../common/StatusBadge";

export function TopBar() {
  const model = useProject((s) => s.model);
  const dirty = useProject((s) => s.dirtyFiles);
  const saving = useProject((s) => s.saving);
  const source = useProject((s) => s.source);
  const error = useProject((s) => s.error);
  const save = useProject((s) => s.save);
  const summary = useResults((s) => s.results?.summary);
  const computing = useResults((s) => s.computing);
  const ms = useResults((s) => s.ms);

  return (
    <header className="flex items-center gap-3 h-9 px-3 border-b border-slate-200 bg-slate-800 text-slate-100">
      <span className="font-semibold tracking-tight">OptiPlanner</span>
      <span className="text-slate-400">/</span>
      <span className="font-medium" data-testid="project-name">{model?.project.name ?? "No project"}</span>
      {dirty.length > 0 && (
        <span className="text-amber-300" title={`Unsaved: ${dirty.join(", ")}`}>● {dirty.length} unsaved</span>
      )}
      {source === "sample" && <span className="rounded bg-slate-600 px-1.5 text-[10px] uppercase" title="Server unreachable: bundled sample, saves stay in memory">offline sample</span>}
      <button
        className="rounded bg-sky-600 px-2 py-0.5 text-white disabled:opacity-40 hover:bg-sky-500"
        disabled={!dirty.length || saving}
        onClick={() => void save()}
        title="Save changed files (etag protected)"
      >
        {saving ? "Saving…" : "Save"}
      </button>
      {error && <span className="text-red-300 truncate max-w-md" title={error}>{error}</span>}
      <div className="ml-auto flex items-center gap-1.5">
        {computing && <span className="text-slate-400">computing…</span>}
        {!computing && ms !== null && <span className="text-slate-500 tabular-nums">{ms.toFixed(0)} ms</span>}
        {summary && (
          <>
            <Count n={summary.pass} status="pass" />
            <Count n={summary.warn} status="warn" />
            <Count n={summary.fail} status="fail" />
          </>
        )}
      </div>
    </header>
  );
}
