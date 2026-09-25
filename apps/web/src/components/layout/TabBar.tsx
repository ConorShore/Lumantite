import { TABS, useUi } from "../../store/uiStore";

export function TabBar() {
  const tab = useUi((s) => s.tab);
  const setTab = useUi((s) => s.setTab);
  return (
    <nav className="flex h-8 items-end gap-0.5 border-b border-slate-200 bg-slate-50 px-2" role="tablist">
      {TABS.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => setTab(t.id)}
          className={`px-3 py-1 rounded-t border border-b-0 ${tab === t.id ? "bg-white border-slate-200 font-medium" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
