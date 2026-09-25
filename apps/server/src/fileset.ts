import path from "node:path";
import {
  FileApiError,
  atomicWrite,
  etagOf,
  isProjectParentFile,
  listFilesRecursive,
  readFileIfExists,
  removeFile,
  safeResolve,
  toPosix,
} from "./files.js";

export interface FileEntry {
  text: string;
  etag: string;
}
export type FilesMap = Record<string, FileEntry>;

/** Recursively read every YAML file under `baseDir` into a path -> {text, etag} map. Missing dir yields {}. */
export async function readFilesRecursive(baseDir: string, extensions: string[] = [".yaml", ".yml"]): Promise<FilesMap> {
  const paths = await listFilesRecursive(baseDir, (full) => extensions.some((ext) => full.endsWith(ext)));
  const result: FilesMap = {};
  for (const full of paths) {
    const rel = toPosix(path.relative(baseDir, full));
    const text = await readFileIfExists(full);
    if (text === undefined) continue; // raced with a delete; skip
    result[rel] = { text, etag: etagOf(text) };
  }
  return result;
}

export interface PutFilesBody {
  files?: Record<string, { text: string; etag?: string | null }>;
}

export interface PutFilesOk {
  ok: true;
  files: Record<string, { etag: string }>;
}
export interface PutFilesConflict {
  ok: false;
  conflicts: string[];
  files: Record<string, { text: string; etag: string | null }>;
}
export type PutFilesResult = PutFilesOk | PutFilesConflict;

/**
 * Apply a batch of file writes under `baseDir`, guarded by etags.
 * `etag: null` (or omitted) means "this must be a new file"; a string etag must match the
 * file's current sha1. On any mismatch, nothing is written and a 409-shaped result is returned
 * with the current on-disk text/etag for every path in the request (so the client can merge).
 */
export async function putFiles(baseDir: string, body: PutFilesBody): Promise<PutFilesResult> {
  const entries = Object.entries(body.files ?? {});
  const resolved = entries.map(([relPath, v]) => ({
    relPath,
    fullPath: safeResolve(baseDir, relPath), // throws FileApiError(400) on traversal
    text: v?.text ?? "",
    etag: v?.etag ?? null,
  }));

  const current = new Map<string, { text: string; etag: string } | undefined>();
  for (const e of resolved) {
    const text = await readFileIfExists(e.fullPath);
    current.set(e.relPath, text === undefined ? undefined : { text, etag: etagOf(text) });
  }

  const conflicts: string[] = [];
  for (const e of resolved) {
    const cur = current.get(e.relPath);
    if (e.etag === null) {
      if (cur !== undefined) conflicts.push(e.relPath); // expected a new file, one already exists
    } else if (cur === undefined || cur.etag !== e.etag) {
      conflicts.push(e.relPath);
    }
  }

  if (conflicts.length > 0) {
    const files: Record<string, { text: string; etag: string | null }> = {};
    for (const e of resolved) {
      const cur = current.get(e.relPath);
      files[e.relPath] = cur ? { text: cur.text, etag: cur.etag } : { text: "", etag: null };
    }
    return { ok: false, conflicts, files };
  }

  const outFiles: Record<string, { etag: string }> = {};
  for (const e of resolved) {
    await atomicWrite(e.fullPath, e.text);
    outFiles[e.relPath] = { etag: etagOf(e.text) };
  }
  return { ok: true, files: outFiles };
}

/**
 * Delete a single file under `baseDir`, with the same traversal protection as reads/writes:
 * `safeResolve` throws FileApiError(400) for a path outside `baseDir`. Throws FileApiError(404)
 * if the file does not exist, and FileApiError(409) if it is a project parent file (top-level
 * `optiplanner: 1`) — those must be removed by deleting/renaming the project, not this route.
 */
export async function deleteFile(baseDir: string, relPath: string): Promise<void> {
  const fullPath = safeResolve(baseDir, relPath); // throws FileApiError(400) on traversal
  const text = await readFileIfExists(fullPath);
  if (text === undefined) {
    throw new FileApiError(404, `file not found: ${relPath}`);
  }
  if (isProjectParentFile(text)) {
    throw new FileApiError(409, `refusing to delete a project parent file: ${relPath}`);
  }
  await removeFile(fullPath);
}
