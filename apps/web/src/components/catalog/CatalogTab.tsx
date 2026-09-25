import { useEffect, useMemo, useState } from "react";
import { DEVICE_KINDS } from "@lumantite/schema";
import { useCatalog, type RawEntry } from "../../store/catalogStore";
import { useProject } from "../../store/projectStore";
import { useUi } from "../../store/uiStore";
import { SEVERITY_CLASS } from "../../lib/status";
import { ObjectEditor, type Json } from "./ValueEditor";
import { fieldSuggestions, requiredSkeleton } from "./fieldDefaults";

const KINDS = [...DEVICE_KINDS, "wavelength-plan"] as string[];
const DEFAULT_FILE: Record<string, string> = {
  transceiver: "transceivers.yaml", fibre: "fibres.yaml", joint: "joints.yaml", mux: "muxes.yaml", amplifier: "amplifiers.yaml",
  attenuator: "passives.yaml", dcm: "passives.yaml", splitter: "passives.yaml", passthrough: "passives.yaml", host: "passives.yaml",
  "wavelength-plan": "wavelength-plans.yaml",
};

function useUsage(): Map<string, number> {
  const model = useProject((s) => s.model);
  return useMemo(() => {
    const m = new Map<string, number>();
    const inc = (id: string | undefined) => id && m.set(id, (m.get(id) ?? 0) + 1);
    for (const n of model?.nodes ?? []) inc(n.model);
    for (const f of model?.fibres ?? []) { inc(f.type); inc(f.a.joint); inc(f.b.joint); }
    for (const p of model?.project.wavelength_plans ?? []) inc(p);
    return m;
  }, [model]);
}

export function CatalogTab() {
  const rows = useCatalog((s) => s.rows);
  const dirty = useCatalog((s) => s.dirtyFiles);
  const saving = useCatalog((s) => s.saving);
  const error = useCatalog((s) => s.error);
  const save = useCatalog((s) => s.save);
  const kind = useUi((s) => s.catalogKind);
  const selectedId = useUi((s) => s.catalogSelected);
  const setView = useUi((s) => s.setCatalogView);
  const usage = useUsage();
  const [q, setQ] = useState("");
  const [draftNew, setDraftNew] = useState<{ file: string; entry: RawEntry } | null>(null);

  const list = useMemo(() => rows.filter((r) => r.entry.kind === kind && (!q || JSON.stringify(r.entry).toLowerCase().includes(q.toLowerCase()))), [rows, kind, q]);
  const counts = useMemo(() => { const c = new Map<string, number>(); for (const r of rows) c.set(r.entry.kind, (c.get(r.entry.kind) ?? 0) + 1); return c; }, [rows]);
  const selected = draftNew ?? rows.find((r) => r.entry.id === selectedId && !r.local) ?? rows.find((r) => r.entry.id === selectedId);
  const files = useMemo(() => [...new Set([...rows.filter((r) => !r.local).map((r) => r.file), ...Object.values(DEFAULT_FILE)])].sort(), [rows]);
  const str = (v: unknown) => (typeof v === "string" ? v : "");

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 border-b border-line bg-surface px-2 py-1 flex-wrap">
        {KINDS.map((k) => (
          <button key={k} className={`seg ${k === kind ? "is-active" : ""}`} onClick={() => { setView(k, null); setDraftNew(null); }}>
            {k} <span className="opacity-60">{counts.get(k) ?? 0}</span>
          </button>
        ))}
        <input className="field ml-auto" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-new" onClick={() => setDraftNew({ file: DEFAULT_FILE[kind] ?? "catalog.yaml", entry: { kind, id: `new-${kind}`, ...requiredSkeleton(kind) } as RawEntry })}>+ New</button>
        <button className={dirty.length ? "btn-primary ring-2 ring-aqua/70 ring-offset-1 ring-offset-surface" : "btn"} disabled={!dirty.length || saving} onClick={() => void save()} title={dirty.length ? `Unsaved: ${dirty.join(", ")}` : "No unsaved catalog changes"}>
          {saving ? "Saving…" : `Save catalog${dirty.length ? ` (${dirty.length})` : ""}`}
        </button>
      </div>
      {error && <div className="border-b border-fail/40 bg-fail/10 px-2 py-1 text-fail">{error}</div>}
      <div className="flex flex-1 min-h-0">
        <div className="w-[48%] overflow-auto border-r border-line bg-page">
          <table className="w-full whitespace-nowrap text-[11px]">
            <thead className="sticky top-0 z-[1] bg-raised shadow-[0_1px_0_var(--color-line)]">
              <tr className="text-left text-muted [&>th]:py-0.5 [&>th]:font-medium"><th className="px-2">id</th><th className="px-1">vendor / model</th><th className="px-1">description</th><th className="px-1">extends</th><th className="px-1">file</th><th className="text-right pr-2">used</th></tr>
            </thead>
            <tbody>
              {list.map((r, idx) => (
                <tr
                  key={`${r.local}:${r.file}:${r.entry.id}`}
                  className={`cursor-pointer border-t border-line-soft ${selected?.entry.id === r.entry.id && !draftNew ? "bg-accent/15 text-accent" : `${idx % 2 ? "bg-surface" : "bg-page"} hover:bg-raised`}`}
                  onClick={() => { setDraftNew(null); setView(kind, r.entry.id); }}
                >
                  <td className="px-2 font-mono">{r.entry.id}{r.local && <span className="ml-1 rounded border border-aqua/40 bg-aqua/10 px-1 text-aqua" title="project-local override (read-only here)">local</span>}</td>
                  <td>{[str(r.entry.vendor), str(r.entry.model)].filter(Boolean).join(" ")}</td>
                  <td className="max-w-40 truncate px-1" title={str(r.entry.description)}>{str(r.entry.description)}</td>
                  <td className="font-mono">{str(r.entry.extends)}</td>
                  <td className="text-muted">{r.file}</td>
                  <td className="pr-2 text-right tabular-nums">{usage.get(r.entry.id) ?? 0}</td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={6} className="px-2 py-2 text-muted">No {kind} models.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex-1 min-w-0 overflow-auto">
          {selected ? (
            <EntryEditor
              key={`${draftNew ? "new" : "sel"}:${selected.entry.id}`}
              file={selected.file}
              entry={selected.entry}
              isNew={!!draftNew}
              readOnly={!draftNew && !!(selected as { local?: boolean }).local}
              files={files}
              onDone={(id) => { setDraftNew(null); if (id) setView(kind, id); }}
              onClone={(e) => setDraftNew({ file: selected.file, entry: e })}
            />
          ) : (
            <div className="p-4 text-muted">Select a model to edit, or create a new one.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function EntryEditor({ file, entry, isNew, readOnly, files, onDone, onClone }: {
  file: string; entry: RawEntry; isNew: boolean; readOnly: boolean; files: string[];
  onDone(id?: string): void; onClone(e: RawEntry): void;
}) {
  const rows = useCatalog((s) => s.rows);
  const upsert = useCatalog((s) => s.upsert);
  const remove = useCatalog((s) => s.remove);
  const resolved = useCatalog((s) => s.catalog.models.get(entry.id) ?? s.catalog.plans.get(entry.id));
  const allIssues = useCatalog((s) => s.issues);
  const issues = useMemo(() => allIssues.filter((i) => i.element === entry.id), [allIssues, entry.id]);
  const usage = useUsage().get(entry.id) ?? 0;
  const [draft, setDraft] = useState<RawEntry>(() => structuredClone(entry));
  const [target, setTarget] = useState(file);
  useEffect(() => setDraft(structuredClone(entry)), [entry]);
  const changed = isNew || JSON.stringify(draft) !== JSON.stringify(entry);
  const sameKind = rows.filter((r) => r.entry.kind === entry.kind && r.entry.id !== draft.id).map((r) => r.entry.id);
  const idTaken = draft.id !== entry.id && rows.some((r) => r.entry.id === draft.id);

  const apply = () => {
    if (!draft.id || idTaken) return;
    if (!isNew && draft.id !== entry.id) remove(entry.id); // rename = remove + upsert
    upsert(target, draft);
    onDone(draft.id);
  };
  return (
    <div className="p-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="rounded bg-line px-1.5 text-[10px] uppercase text-fg">{entry.kind}</span>
        <input className={`field font-mono ${idTaken ? "!border-fail" : ""}`} value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} disabled={readOnly} aria-label="id" />
        {entry.kind !== "wavelength-plan" && (
          <label className="flex items-center gap-1">extends
            <select className="field" value={(draft.extends as string) ?? ""} disabled={readOnly} onChange={(e) => { const n = { ...draft }; if (e.target.value) n.extends = e.target.value; else delete n.extends; setDraft(n); }}>
              <option value="">—</option>
              {sameKind.map((id) => <option key={id}>{id}</option>)}
            </select>
          </label>
        )}
        <span className="ml-auto text-muted">used by {usage} in this project</span>
      </div>
      <label className="flex items-center gap-1">file
        <input className="field font-mono" list="catalog-files" value={target} disabled={!isNew || readOnly} onChange={(e) => setTarget(e.target.value)} />
        <datalist id="catalog-files">{files.map((f) => <option key={f} value={f} />)}</datalist>
      </label>
      {readOnly && <div className="text-aqua">Project-local override: edit it in the project's catalog/ directory.</div>}
      {issues.map((i, n) => <div key={n} className={SEVERITY_CLASS[i.severity]}>{i.code}: {i.message}</div>)}
      <fieldset disabled={readOnly}>
        <ObjectEditor
          value={draft as unknown as Record<string, Json>}
          onChange={(v) => setDraft(v as unknown as RawEntry)}
          hide={["kind", "id", "extends"]}
          suggestions={fieldSuggestions(entry.kind)}
        />
      </fieldset>
      {!readOnly && (
        <div className="flex gap-1">
          <button className="btn-primary" disabled={!changed || idTaken || !draft.id} onClick={apply}>{isNew ? "Add" : "Apply"}</button>
          <button className="btn" disabled={!changed} onClick={() => (isNew ? onDone() : setDraft(structuredClone(entry)))}>{isNew ? "Cancel" : "Revert"}</button>
          {!isNew && entry.kind !== "wavelength-plan" && (
            <button className="btn-new" title="New model that extends this one" onClick={() => onClone({ kind: entry.kind, id: `${entry.id}-copy`, extends: entry.id } as RawEntry)}>Clone (extends)</button>
          )}
          {!isNew && (
            <button className="btn-danger ml-auto" onClick={() => { if (!usage || window.confirm(`${entry.id} is used ${usage}× in this project. Delete anyway?`)) { remove(entry.id); onDone(); } }}>Delete</button>
          )}
        </div>
      )}
      {resolved && entry.extends !== undefined && (
        <details>
          <summary className="cursor-pointer text-muted hover:text-fg">Effective model (extends resolved)</summary>
          <pre className="mt-1 max-h-72 overflow-auto rounded border border-line bg-page p-1 text-[10px]">{JSON.stringify(resolved, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
