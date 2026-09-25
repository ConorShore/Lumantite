import { useMemo } from "react";
import { useProject } from "../../store/projectStore";
import { useCatalog } from "../../store/catalogStore";
import { useUi } from "../../store/uiStore";

interface Props { paletteOpen: boolean; onTogglePalette(): void; onNewFile(): void; onNewSite(): void; onFit(): void }

export function CanvasToolbar({ paletteOpen, onTogglePalette, onNewFile, onNewSite, onFit }: Props) {
  const model = useProject((s) => s.model);
  const catalog = useCatalog((s) => s.catalog);
  const showFrames = useUi((s) => s.showFileFrames);
  const toggleFrames = useUi((s) => s.toggleFileFrames);
  const filter = useUi((s) => s.channelFilter);
  const setFilter = useUi((s) => s.setChannelFilter);
  const plans = useMemo(() => {
    const ids = model?.project.wavelength_plans?.length ? model.project.wavelength_plans : [...catalog.plans.keys()];
    return ids.filter((id) => catalog.plans.has(id));
  }, [model, catalog]);
  const plan = filter?.plan ?? plans[0] ?? "";
  const channels = plan ? catalog.channels(plan) : [];
  const btn = "rounded border border-slate-300 bg-white px-2 py-0.5 hover:bg-slate-50";
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-2 py-1">
      <button className={`${btn} ${paletteOpen ? "bg-sky-50 border-sky-300" : ""}`} onClick={onTogglePalette} aria-pressed={paletteOpen}>Palette</button>
      <label className={`${btn} flex items-center gap-1 cursor-pointer`}>
        <input type="checkbox" checked={showFrames} onChange={toggleFrames} /> File frames
      </label>
      <button className={btn} onClick={onNewFile}>+ New file</button>
      <button className={btn} onClick={onNewSite}>+ New site</button>
      <button className={btn} onClick={onFit}>Fit</button>
      <span className="ml-2 text-slate-500">λ filter</span>
      <select className="rounded border px-1" value={plan} onChange={(e) => setFilter(filter ? { plan: e.target.value, channel: "" } : null)} aria-label="Wavelength plan">
        {plans.map((p) => <option key={p}>{p}</option>)}
      </select>
      <select
        className="rounded border px-1"
        value={filter?.channel ?? ""}
        onChange={(e) => setFilter(e.target.value ? { plan, channel: e.target.value } : null)}
        aria-label="Channel filter"
      >
        <option value="">all channels</option>
        {channels.map((c) => <option key={c.id} value={c.id}>{c.id} · {c.wavelength_nm.toFixed(2)} nm</option>)}
      </select>
    </div>
  );
}
