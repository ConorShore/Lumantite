import { useEffect } from "react";
import { useUi } from "../../store/uiStore";

export function Toast() {
  const toast = useUi((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useUi.setState({ toast: null }), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div role="status" className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center rounded border border-l-4 bg-raised px-3 py-2 text-fg shadow-xl shadow-black/40 ${toast.kind === "error" ? "border-fail/70" : "border-aqua/60"}`}>
      {toast.text}
      <button className="ml-3 text-muted hover:text-fg" aria-label="Dismiss" onClick={() => useUi.setState({ toast: null })}>×</button>
    </div>
  );
}
