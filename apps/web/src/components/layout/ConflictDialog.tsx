import { useProject } from "../../store/projectStore";

export function ConflictDialog() {
  const conflict = useProject((s) => s.conflict);
  const resolve = useProject((s) => s.resolveConflict);
  if (!conflict) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-page/75 backdrop-blur-[1px]" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
      <div className="w-[420px] rounded-md border border-fail/60 bg-surface p-4 text-fg shadow-2xl shadow-black/40">
        <h2 id="conflict-title" className="mb-2 flex items-center gap-2 text-sm font-semibold"><span className="text-fail" aria-hidden>⚠</span>Files changed on disk</h2>
        <p className="mb-2 text-muted">These files were modified by someone else since you loaded them:</p>
        <ul className="mb-3 list-disc rounded border border-line bg-page py-1 pl-6 font-mono text-fg">{conflict.paths.map((p) => <li key={p}>{p}</li>)}</ul>
        <p className="mb-4 text-muted"><b className="text-fg">Reload</b> discards your unsaved changes and loads the disk version. <b className="text-fg">Overwrite</b> replaces the disk version with yours.</p>
        <div className="flex justify-end gap-2">
          <button className="btn px-3 py-1" onClick={() => void resolve("cancel")}>Cancel</button>
          <button className="btn px-3 py-1" onClick={() => void resolve("reload")}>Reload from disk</button>
          <button className="rounded border border-fail bg-fail px-3 py-1 font-medium text-on-accent hover:bg-fail/85" onClick={() => void resolve("overwrite")}>Overwrite</button>
        </div>
      </div>
    </div>
  );
}
