/** Smallest single replacement turning `a` into `b` (common prefix/suffix trim). Offsets into `a`. */
export function minimalEdit(a: string, b: string): { start: number; end: number; text: string } | null {
  if (a === b) return null;
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) { endA--; endB--; }
  return { start, end: endA, text: b.slice(start, endB) };
}
