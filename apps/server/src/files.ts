import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

/** Thrown for any file-API problem that should be surfaced to the HTTP client with a specific status code. */
export class FileApiError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = "FileApiError";
  }
}

/** sha1 etag of file text. */
export function etagOf(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

/** Normalise a path to forward slashes for use as a stable map key / API path. */
export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/**
 * Resolve `relPath` under `baseDir`, rejecting anything that would escape it
 * (absolute paths, `..` traversal, NUL bytes) with a 400 FileApiError.
 */
export function safeResolve(baseDir: string, relPath: string): string {
  if (typeof relPath !== "string" || relPath.length === 0) {
    throw new FileApiError(400, "invalid path: empty");
  }
  if (relPath.includes("\0")) {
    throw new FileApiError(400, `invalid path: ${relPath}`);
  }
  if (path.isAbsolute(relPath)) {
    throw new FileApiError(400, `path must be relative: ${relPath}`);
  }
  const base = path.resolve(baseDir);
  const target = path.resolve(base, relPath);
  const rel = path.relative(base, target);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new FileApiError(400, `path escapes base directory: ${relPath}`);
  }
  return target;
}

/** Read a file, returning undefined (instead of throwing) if it does not exist. */
export async function readFileIfExists(p: string): Promise<string | undefined> {
  try {
    return await fs.readFile(p, "utf8");
  } catch (err: any) {
    // ENOENT: no such path. ENOTDIR: a path component (e.g. a parent) is actually a file, as
    // happens for a bogus nested request like `/api/projects/existing-file.yaml/extra`.
    // Both mean "there is no such file" from the caller's point of view.
    if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return undefined;
    throw err;
  }
}

/** Write a file atomically: write to a temp file in the same directory, then rename. Creates parent dirs. */
export async function atomicWrite(p: string, text: string): Promise<void> {
  const dir = path.dirname(p);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(p)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  await fs.writeFile(tmp, text, "utf8");
  await fs.rename(tmp, p);
}

/** Delete a file. Throws FileApiError(404) if it does not exist. */
export async function removeFile(p: string): Promise<void> {
  try {
    await fs.unlink(p);
  } catch (err: any) {
    if (err?.code === "ENOENT" || err?.code === "ENOTDIR") throw new FileApiError(404, `file not found: ${toPosix(p)}`);
    throw err;
  }
}

/** True if `text` parses as YAML whose top level has `optiplanner: 1` (a project parent file). */
export function isProjectParentFile(text: string): boolean {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch {
    return false;
  }
  return !!doc && typeof doc === "object" && (doc as Record<string, unknown>).optiplanner === 1;
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** True if `p` does not exist or is an empty directory. */
export async function isDirEmpty(p: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(p);
    return entries.length === 0;
  } catch (err: any) {
    if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return true;
    throw err;
  }
}

/** Recursively list files under `baseDir` matching `filter` (given the full path). Missing baseDir yields []. */
export async function listFilesRecursive(baseDir: string, filter: (fullPath: string) => boolean): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && filter(full)) {
        results.push(full);
      }
    }
  }
  await walk(baseDir);
  return results;
}
