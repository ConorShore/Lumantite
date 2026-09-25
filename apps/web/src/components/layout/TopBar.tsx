import { useProject } from "../../store/projectStore";
import { useResults } from "../../store/resultsStore";
import { useState } from "react";
import { Count } from "../common/StatusBadge";
import { AboutDialog } from "./AboutDialog";

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
  const [about, setAbout] = useState(false);

  return (
    <header className="flex items-center gap-3 h-9 px-3 border-b border-line bg-surface text-fg">
      <span className="flex items-center gap-2 select-none">
        <img src="/logo.svg" alt="" width={16} height={16} aria-hidden="true" />
        <span className="text-[14px] font-semibold tracking-tight text-accent">Lumantite</span>
        <span className="font-mono text-[10px] text-muted">optical planner</span>
      </span>
      <span className="text-faint">/</span>
      <span className="font-medium" data-testid="project-name">{model?.project.name ?? "No project"}</span>
      {dirty.length > 0 && (
        <span className="text-aqua" title={`Unsaved: ${dirty.join(", ")}`}>● {dirty.length} unsaved</span>
      )}
      {source === "sample" && <span className="rounded border border-line bg-raised px-1.5 text-[10px] uppercase text-muted" title="Server unreachable: bundled sample, saves stay in memory">offline sample</span>}
      <button
        className={dirty.length ? "btn-primary py-0.5 ring-2 ring-aqua/70 ring-offset-1 ring-offset-surface" : "btn py-0.5"}
        disabled={!dirty.length || saving}
        onClick={() => void save()}
        title={dirty.length ? `Save ${dirty.length} changed file${dirty.length > 1 ? "s" : ""} (etag protected)` : "No unsaved changes"}
      >
        {saving ? "Saving…" : "Save"}
      </button>
      {error && <span className="text-fail truncate max-w-md" title={error}>{error}</span>}
      <div className="ml-auto flex items-center gap-1.5">
        {computing && <span className="text-muted">computing…</span>}
        {!computing && ms !== null && (
          <span className="rounded border border-aqua/35 bg-aqua/10 px-1.5 leading-5 text-aqua tabular-nums" title="Last recompute time">{ms.toFixed(0)} ms</span>
        )}
        {summary && (
          <>
            <Count n={summary.pass} status="pass" />
            <Count n={summary.warn} status="warn" />
            <Count n={summary.fail} status="fail" />
          </>
        )}
        <button className="btn py-0.5" onClick={() => setAbout(true)} title="About Lumantite and disclaimer" aria-label="About">?</button>
      </div>
      <AboutDialog open={about} onClose={() => setAbout(false)} />
    </header>
  );
}
