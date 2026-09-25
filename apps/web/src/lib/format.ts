import type { Triple } from "@lumantite/schema";

export const dB = (v: number | undefined | null, digits = 2): string =>
  v === undefined || v === null || !Number.isFinite(v) ? "–" : v.toFixed(digits);
export const triple = (t: Triple | undefined): string => (t ? `${dB(t.min)} / ${dB(t.typ)} / ${dB(t.max)}` : "–");
export const nm = (v: number | undefined): string => (v === undefined ? "–" : v.toFixed(2));
export const cd = (v: number | undefined): string => (v === undefined || !Number.isFinite(v) ? "–" : v.toFixed(1));
