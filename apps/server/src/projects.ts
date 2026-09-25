import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { FileApiError, atomicWrite, etagOf, listFilesRecursive, readFileIfExists, safeResolve, toPosix } from "./files.js";
import type { FilesMap } from "./fileset.js";

export interface ProjectSummary {
  id: string;
  name: string;
  rootFile: string;
}

/** Scan `projectsDir` recursively for `*.yaml` files whose top level has `lumantite: 1`. */
export async function listProjects(projectsDir: string): Promise<ProjectSummary[]> {
  const files = await listFilesRecursive(projectsDir, (p) => p.endsWith(".yaml") || p.endsWith(".yml"));
  const result: ProjectSummary[] = [];
  for (const full of files) {
    const text = await readFileIfExists(full);
    if (text === undefined) continue;
    let doc: unknown;
    try {
      doc = parseYaml(text);
    } catch {
      continue;
    }
    if (!doc || typeof doc !== "object" || (doc as Record<string, unknown>).lumantite !== 1) continue;
    const project = (doc as Record<string, unknown>).project as Record<string, unknown> | undefined;
    const rel = toPosix(path.relative(projectsDir, full));
    const name = typeof project?.name === "string" ? project.name : rel;
    result.push({ id: rel, name, rootFile: rel });
  }
  result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

export interface ProjectGetResult {
  rootFile: string;
  files: FilesMap;
  missing?: string[];
}

/**
 * Read a project's parent file plus every file it `includes` (one level, relative to the
 * parent's own directory). Missing include files are reported in `missing` rather than
 * failing the whole request.
 */
export async function getProject(projectsDir: string, id: string): Promise<ProjectGetResult> {
  const parentId = toPosix(id);
  const parentFull = safeResolve(projectsDir, parentId);
  const parentText = await readFileIfExists(parentFull);
  if (parentText === undefined) {
    throw new FileApiError(404, `project not found: ${parentId}`);
  }

  const files: FilesMap = { [parentId]: { text: parentText, etag: etagOf(parentText) } };
  const missing: string[] = [];

  let parsed: unknown;
  try {
    parsed = parseYaml(parentText);
  } catch {
    parsed = undefined;
  }
  const includes = Array.isArray((parsed as Record<string, unknown> | undefined)?.includes)
    ? ((parsed as Record<string, unknown>).includes as unknown[])
    : [];
  const parentDir = path.dirname(parentId); // "." if the parent is at the projects root

  for (const inc of includes) {
    const file = (inc as Record<string, unknown> | undefined)?.file;
    if (typeof file !== "string" || file.length === 0) continue;
    const relToProjectsDir = toPosix(parentDir === "." ? file : path.join(parentDir, file));

    let full: string;
    try {
      full = safeResolve(projectsDir, relToProjectsDir);
    } catch {
      missing.push(relToProjectsDir);
      continue;
    }
    const text = await readFileIfExists(full);
    if (text === undefined) {
      missing.push(relToProjectsDir);
      continue;
    }
    files[relToProjectsDir] = { text, etag: etagOf(text) };
  }

  return missing.length > 0 ? { rootFile: parentId, files, missing } : { rootFile: parentId, files };
}

/**
 * Minimal parent-file text, used only if `@lumantite/project`'s `newProjectText` is not
 * available yet (that package is built concurrently). Shape matches SPEC §6's parent file.
 */
function fallbackNewProjectText(name: string): string {
  return stringifyYaml({ lumantite: 1, project: { name } });
}

// `@lumantite/project` is built concurrently by another agent and may not have compiled
// output/types yet. Import it via a non-literal specifier so TypeScript does not try to
// statically resolve its types at build time; the try/catch handles it being absent at runtime.
const PROJECT_PACKAGE = "@lumantite/project";

/** Import `@lumantite/project`'s `newProjectText` if it builds; otherwise fall back to a minimal parent file. */
export async function newProjectText(name: string): Promise<string> {
  try {
    const mod: any = await import(PROJECT_PACKAGE);
    if (typeof mod.newProjectText === "function") {
      return mod.newProjectText(name) as string;
    }
  } catch {
    // package not built / not available yet: fall through to the local fallback
  }
  return fallbackNewProjectText(name);
}

export interface CreateProjectResult {
  rootFile: string;
  files: FilesMap;
}

export async function createProject(
  projectsDir: string,
  body: { rootFile?: string; name?: string },
): Promise<CreateProjectResult> {
  if (typeof body.rootFile !== "string" || body.rootFile.length === 0) {
    throw new FileApiError(400, "rootFile is required");
  }
  if (typeof body.name !== "string" || body.name.length === 0) {
    throw new FileApiError(400, "name is required");
  }
  const rootFile = toPosix(body.rootFile);
  const full = safeResolve(projectsDir, rootFile);
  const existing = await readFileIfExists(full);
  if (existing !== undefined) {
    throw new FileApiError(409, `project already exists: ${rootFile}`);
  }
  const text = await newProjectText(body.name);
  await atomicWrite(full, text);
  return { rootFile, files: { [rootFile]: { text, etag: etagOf(text) } } };
}
