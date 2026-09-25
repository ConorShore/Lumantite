/** Fetch wrappers for the server HTTP API (docs/CONTRACT.md § @optiplanner/server). */
import type { AppConfig } from "@optiplanner/schema";

export interface ProjectListItem { id: string; name: string; rootFile: string }
export interface FileWithEtag { text: string; etag: string }
export type FileMap = Record<string, FileWithEtag>;
export interface ProjectPayload { rootFile: string; files: FileMap }
/** etag `null` means "new file". */
export type PutFiles = Record<string, { text: string; etag?: string | null }>;
export type PutResult =
  | { ok: true; files: Record<string, { etag: string }> }
  | { ok: false; conflicts: string[]; files: FileMap };

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const base = "/api";
/** Project ids are root-file paths (may contain '/'); encode each segment. */
export const encodeId = (id: string) => id.split("/").map(encodeURIComponent).join("/");

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new ApiError(`${res.status} ${res.statusText} ${await res.text().catch(() => "")}`.trim(), res.status);
  return (await res.json()) as T;
}
const send = (method: string, body: unknown): RequestInit => ({
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
async function put(url: string, files: PutFiles): Promise<PutResult> {
  const res = await fetch(url, send("PUT", { files }));
  if (res.status === 409) {
    const b = (await res.json()) as { conflicts: string[]; files: FileMap };
    return { ok: false, conflicts: b.conflicts, files: b.files ?? {} };
  }
  const b = await json<{ files: Record<string, { etag: string }> }>(res);
  return { ok: true, files: b.files };
}

export const api = {
  getConfig: () => fetch(`${base}/config`).then((r) => json<AppConfig>(r)),
  listProjects: () => fetch(`${base}/projects`).then((r) => json<ProjectListItem[]>(r)),
  getProject: (id: string) => fetch(`${base}/projects/${encodeId(id)}`).then((r) => json<ProjectPayload>(r)),
  putProjectFiles: (id: string, files: PutFiles) => put(`${base}/projects/${encodeId(id)}/files`, files),
  createProject: (rootFile: string, name: string) =>
    fetch(`${base}/projects`, send("POST", { rootFile, name })).then((r) => json<unknown>(r)),
  getCatalog: () => fetch(`${base}/catalog`).then((r) => json<{ files: FileMap }>(r)),
  putCatalogFiles: (files: PutFiles) => put(`${base}/catalog/files`, files),
  getProjectCatalog: (id: string) => fetch(`${base}/projects/${encodeId(id)}/catalog`).then((r) => json<{ files: FileMap }>(r)),
  putProjectCatalogFiles: (id: string, files: PutFiles) => put(`${base}/projects/${encodeId(id)}/catalog/files`, files),
};
