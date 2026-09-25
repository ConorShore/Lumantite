import type { CheckStatus, Severity } from "@lumantite/schema";

export const STATUS_RANK: Record<CheckStatus, number> = { "n/a": 0, pass: 1, warn: 2, fail: 3 };
export const worstStatus = (a: CheckStatus, b: CheckStatus): CheckStatus => (STATUS_RANK[b] > STATUS_RANK[a] ? b : a);

/**
 * Stroke / fill colours used on the canvas (SVG, minimap), mirroring --color-pass/warn/fail/na in index.css.
 * Warn is orange (not yellow) so it never reads as the gold selection accent.
 */
export const STATUS_COLOR: Record<CheckStatus, string> = {
  pass: "#4ade80", warn: "#fb923c", fail: "#f87171", "n/a": "#8b8e96",
};
/** Badge / chip / tinted-row classes (theme tokens from index.css). */
export const STATUS_CLASS: Record<CheckStatus, string> = {
  pass: "bg-pass/12 text-pass border-pass/40",
  warn: "bg-warn/12 text-warn border-warn/40",
  fail: "bg-fail/12 text-fail border-fail/45",
  "n/a": "bg-raised text-muted border-line",
};
/** Issue severity text colour. Info uses the aqua offset accent. */
export const SEVERITY_CLASS: Record<Severity, string> = {
  error: "text-fail",
  warn: "text-warn",
  info: "text-aqua",
};
