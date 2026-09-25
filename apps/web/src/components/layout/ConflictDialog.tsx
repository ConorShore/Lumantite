import { useProject } from "../../store/projectStore";

export function ConflictDialog() {
  const conflict = useProject((s) => s.conflict);
  const resolve = useProject((s) => s.resolveConflict);
  if (!conflict) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
      <div className="w-[420px] rounded-md bg-white p-4 shadow-xl">
        <h2 id="conflict-title" className="mb-2 text-sm font-semibold">Files changed on disk</h2>
        <p className="mb-2 text-slate-600">These files were modified by someone else since you loaded them:</p>
        <ul className="mb-3 list-disc pl-5 font-mono">{conflict.paths.map((p) => <li key={p}>{p}</li>)}</ul>
        <p className="mb-4 text-slate-600"><b>Reload</b> discards your unsaved changes and loads the disk version. <b>Overwrite</b> replaces the disk version with yours.</p>
        <div className="flex justify-end gap-2">
          <button className="rounded border px-3 py-1" onClick={() => void resolve("cancel")}>Cancel</button>
          <button className="rounded border border-slate-300 px-3 py-1" onClick={() => void resolve("reload")}>Reload from disk</button>
          <button className="rounded bg-red-600 px-3 py-1 text-white" onClick={() => void resolve("overwrite")}>Overwrite</button>
        </div>
      </div>
    </div>
  );
}
