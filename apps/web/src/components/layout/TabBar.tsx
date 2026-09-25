import { TABS, useUi } from "../../store/uiStore";

export function TabBar() {
  const tab = useUi((s) => s.tab);
  const setTab = useUi((s) => s.setTab);
  return (
    <nav className="flex h-8 items-end gap-1 border-b border-line bg-surface px-2" role="tablist">
      {TABS.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => setTab(t.id)}
          className={`-mb-px px-3 py-1 border-b-2 ${tab === t.id ? "border-accent text-fg font-medium" : "border-transparent text-muted hover:text-fg hover:border-line"}`}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
