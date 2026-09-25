import { useMemo, useState } from "react";
import { useProject } from "../../store/projectStore";
import { useCatalog } from "../../store/catalogStore";
import { useUi } from "../../store/uiStore";

export function Sidebar() {
  return (
    <aside className="w-56 shrink-0 flex flex-col bg-slate-50 min-h-0">
      <Projects />
      <CatalogTree />
    </aside>
  );
}

function Projects() {
  const projects = useProject((s) => s.projects);
  const current = useProject((s) => s.projectId);
  const open = useProject((s) => s.open);
  const create = useProject((s) => s.createProject);
  const dirty = useProject((s) => s.dirtyFiles.length);
  const [name, setName] = useState<string | null>(null);

  const pick = (id: string) => {
    if (id === current) return;
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    void open(id);
  };
  return (
    <section className="border-b border-slate-200">
      <h3 className="flex items-center px-2 h-7 font-semibold text-slate-600 uppercase text-[10px] tracking-wider">
        Projects
        <button className="ml-auto text-sky-700 normal-case tracking-normal text-xs" onClick={() => setName("")}>+ New</button>
      </h3>
      {name !== null && (
        <form className="flex gap-1 px-2 pb-1" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void create(name.trim()); setName(null); }}>
          <input autoFocus className="flex-1 min-w-0 rounded border px-1" placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setName(null)} />
          <button className="rounded bg-sky-600 px-2 text-white">Create</button>
        </form>
      )}
      <ul className="max-h-48 overflow-auto pb-1">
        {projects.map((p) => (
          <li key={p.id}>
            <button className={`w-full text-left px-3 py-0.5 truncate ${p.id === current ? "bg-sky-100 font-medium" : "hover:bg-slate-100"}`} onClick={() => pick(p.id)} title={p.rootFile}>
              {p.name}
            </button>
          </li>
        ))}
        {!projects.length && <li className="px-3 text-slate-400">none</li>}
      </ul>
    </section>
  );
}

function CatalogTree() {
  const rows = useCatalog((s) => s.rows);
  const setView = useUi((s) => s.setCatalogView);
  const setTab = useUi((s) => s.setTab);
  const selected = useUi((s) => s.catalogSelected);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of rows) {
      const list = m.get(r.entry.kind) ?? [];
      list.push(r.entry.id);
      m.set(r.entry.kind, list);
    }
    return [...m].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);
  return (
    <section className="flex-1 min-h-0 flex flex-col">
      <h3 className="px-2 h-7 flex items-center font-semibold text-slate-600 uppercase text-[10px] tracking-wider">Catalog</h3>
      <ul className="flex-1 overflow-auto pb-2">
        {groups.map(([kind, ids]) => (
          <li key={kind}>
            <button className="w-full text-left px-2 py-0.5 hover:bg-slate-100" onClick={() => setOpen((o) => ({ ...o, [kind]: !o[kind] }))}>
              <span className="inline-block w-3 text-slate-400">{open[kind] ? "▾" : "▸"}</span>
              {kind} <span className="text-slate-400">({ids.length})</span>
            </button>
            {open[kind] && (
              <ul>
                {ids.map((id) => (
                  <li key={id}>
                    <button
                      className={`w-full text-left pl-7 pr-2 truncate font-mono text-[11px] ${selected === id ? "bg-sky-100" : "hover:bg-slate-100"}`}
                      onClick={() => { setView(kind, id); setTab("catalog"); }}
                      title={id}
                    >
                      {id}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
