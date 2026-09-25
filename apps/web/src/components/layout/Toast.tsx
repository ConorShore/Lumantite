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
    <div role="status" className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded px-3 py-2 shadow-lg ${toast.kind === "error" ? "bg-red-700 text-white" : "bg-slate-800 text-white"}`}>
      {toast.text}
      <button className="ml-3 opacity-70 hover:opacity-100" onClick={() => useUi.setState({ toast: null })}>×</button>
    </div>
  );
}
