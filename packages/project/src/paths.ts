/** Minimal POSIX path helpers (no node:path — this package also runs in the browser). */

/** Normalise separators, drop `.` and empty segments, fold `..`. Never returns a leading `./`. */
export function normPath(p: string): string {
  const abs = p.startsWith("/");
  const out: string[] = [];
  for (const part of p.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!abs) out.push("..");
      continue;
    }
    out.push(part);
  }
  return (abs ? "/" : "") + out.join("/");
}

export function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

export function joinPath(dir: string, rel: string): string {
  return normPath(dir ? `${dir}/${rel}` : rel);
}
