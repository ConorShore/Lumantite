/** Model path ↔ storage path (see adapters/contract.ts ProjectSession doc). */
export const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");

export function joinPath(dir: string, rel: string): string {
  const out: string[] = [];
  for (const s of (dir + rel).split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") out.pop();
    else out.push(s);
  }
  return out.join("/");
}

/** Storage path (key of the server's files map) for a model path. */
export const storageOf = (rootFile: string, modelPath: string): string =>
  modelPath === rootFile ? rootFile : joinPath(dirOf(rootFile), modelPath);
