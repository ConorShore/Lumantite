import type { CheckStatus, Severity } from "@lumantite/schema";

export const STATUS_RANK: Record<CheckStatus, number> = { "n/a": 0, pass: 1, warn: 2, fail: 3 };
export const worstStatus = (a: CheckStatus, b: CheckStatus): CheckStatus => (STATUS_RANK[b] > STATUS_RANK[a] ? b : a);

/** Stroke / fill colours used on the canvas (SVG), matching the Tailwind classes below. */
export const STATUS_COLOR: Record<CheckStatus, string> = {
  pass: "#16a34a", warn: "#d97706", fail: "#dc2626", "n/a": "#94a3b8",
};
export const STATUS_CLASS: Record<CheckStatus, string> = {
  pass: "bg-green-100 text-green-800 border-green-300",
  warn: "bg-amber-100 text-amber-800 border-amber-300",
  fail: "bg-red-100 text-red-800 border-red-300",
  "n/a": "bg-slate-100 text-slate-500 border-slate-200",
};
export const SEVERITY_CLASS: Record<Severity, string> = {
  error: "text-red-700",
  warn: "text-amber-700",
  info: "text-slate-600",
};
