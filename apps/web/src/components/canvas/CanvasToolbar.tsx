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
  const btn = "btn py-0.5";
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface px-2 py-1">
      <button className={`${btn} ${paletteOpen ? "!border-accent/50 !bg-accent/15 text-accent" : ""}`} onClick={onTogglePalette} aria-pressed={paletteOpen}>Palette</button>
      <label className={`${btn} flex items-center gap-1 cursor-pointer`}>
        <input type="checkbox" checked={showFrames} onChange={toggleFrames} /> File frames
      </label>
      <button className="btn-new py-0.5" onClick={onNewFile}>+ New file</button>
      <button className="btn-new py-0.5" onClick={onNewSite}>+ New site</button>
      <button className={btn} onClick={onFit}>Fit</button>
      <span className="ml-2 text-muted">λ filter</span>
      <select className="field" value={plan} onChange={(e) => setFilter(filter ? { plan: e.target.value, channel: "" } : null)} aria-label="Wavelength plan">
        {plans.map((p) => <option key={p}>{p}</option>)}
      </select>
      <select
        className={`field ${filter?.channel ? "!border-accent text-accent" : ""}`}
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
