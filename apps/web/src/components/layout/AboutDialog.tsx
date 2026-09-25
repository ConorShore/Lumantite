import { useEffect } from "react";

const REPO = "https://github.com/ConorShore/Lumantite";

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-page/70" onClick={onClose} role="presentation">
      <div
        className="w-[560px] max-w-[92vw] rounded border border-line bg-surface p-4 text-fg shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline gap-2">
          <h2 id="about-title" className="text-[15px] font-semibold text-accent">Lumantite</h2>
          <span className="font-mono text-[10px] text-muted">optical planner · v0.1.0</span>
          <button className="btn ml-auto py-0.5" onClick={onClose} autoFocus>Close</button>
        </div>
        <h3 className="mt-3 text-[12px] font-semibold uppercase tracking-wide text-muted">Disclaimer</h3>
        <p className="mt-1 text-[12px] leading-relaxed">
          Lumantite is a planning aid. Its power budgets, dispersion figures, amplifier operating points and
          every export are estimates computed from user-supplied catalog data and simplified physical models.
          They may be wrong. The software and its output are provided <strong>as is</strong>, without warranty
          of any kind, and the author accepts <strong>no liability</strong> for any loss, damage or injury
          arising from their use. Verify every design against manufacturer datasheets, applicable standards and
          field measurements before purchasing equipment, commissioning a link or exposing anyone to optical
          radiation.
        </p>
        <p className="mt-2 text-[12px] text-muted">
          Licensed under the Apache License 2.0. Full text: <a className="link" href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">LICENSE</a>,
          {" "}<a className="link" href={`${REPO}/blob/main/DISCLAIMER.md`} target="_blank" rel="noreferrer">DISCLAIMER.md</a>.
        </p>
      </div>
    </div>
  );
}
