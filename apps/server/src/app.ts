import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply } from "fastify";
import type { AppConfig } from "@optiplanner/schema";
import { FileApiError, pathExists, safeResolve, toPosix } from "./files.js";
import { deleteFile, putFiles, readFilesRecursive, type PutFilesBody, type PutFilesResult } from "./fileset.js";
import { createProject, getProject, listProjects } from "./projects.js";

const here = path.dirname(fileURLToPath(import.meta.url));
/** apps/server/src|dist -> apps/web/dist; the relative depth is the same run from source (tsx) or from the build. */
const DEFAULT_WEB_DIST = path.resolve(here, "../../web/dist");

export interface BuildServerOptions {
  /** Override the web SPA dist directory (tests / alternate layouts). Defaults to apps/web/dist. */
  webDist?: string;
  logger?: boolean;
}

/** Directory of a project's parent file (used both to locate the parent and its sibling `catalog/` dir). */
function projectDir(projectsDir: string, id: string): string {
  return path.dirname(safeResolve(projectsDir, id));
}

function respondPutResult(result: PutFilesResult, reply: FastifyReply): unknown {
  if (result.ok) {
    return { files: result.files };
  }
  reply.code(409);
  return { conflicts: result.conflicts, files: result.files };
}

export async function buildServer(config: AppConfig, opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: opts.logger ?? true });

  fastify.setErrorHandler((err: FileApiError | FastifyError, request, reply) => {
    if (err instanceof FileApiError) {
      reply.code(err.statusCode).send({ error: err.message });
      return;
    }
    if (err.validation) {
      reply.code(400).send({ error: err.message });
      return;
    }
    request.log.error(err);
    reply.code(500).send({ error: "internal server error" });
  });

  const projectsDir = config.paths.projects;
  const catalogDir = config.paths.catalog;

  // ---- config ---------------------------------------------------------------
  fastify.get("/api/config", async () => config);

  // ---- projects ---------------------------------------------------------------
  fastify.get("/api/projects", async () => listProjects(projectsDir));

  fastify.post("/api/projects", async (request, reply) => {
    const body = (request.body ?? {}) as { rootFile?: string; name?: string };
    const result = await createProject(projectsDir, body);
    reply.code(201);
    return result;
  });

  // GET /api/projects/:id(*) and GET /api/projects/:id(*)/catalog share one wildcard route,
  // because find-my-way's `*` wildcard must be the final route segment; we split on suffix
  // inside the handler instead of trying to express both shapes as separate routes.
  fastify.get("/api/projects/*", async (request) => {
    const rest = toPosix((request.params as Record<string, string>)["*"] ?? "");
    if (rest.endsWith("/catalog")) {
      const id = rest.slice(0, -"/catalog".length);
      return { files: await readFilesRecursive(path.join(projectDir(projectsDir, id), "catalog")) };
    }
    return getProject(projectsDir, rest);
  });

  fastify.put("/api/projects/*", async (request, reply) => {
    const rest = toPosix((request.params as Record<string, string>)["*"] ?? "");
    const body = (request.body ?? {}) as PutFilesBody;
    if (rest.endsWith("/catalog/files")) {
      const id = rest.slice(0, -"/catalog/files".length);
      const localCatalogDir = path.join(projectDir(projectsDir, id), "catalog");
      return respondPutResult(await putFiles(localCatalogDir, body), reply);
    }
    if (rest.endsWith("/files")) {
      const id = rest.slice(0, -"/files".length);
      return respondPutResult(await putFiles(projectsDir, body), reply);
    }
    reply.code(404);
    return { error: "not found" };
  });

  // DELETE /api/projects/*/files?path=<relative to projectsDir> — deletes one project fragment
  // file. Refuses (409) to delete a project parent file (top-level `optiplanner: 1`).
  fastify.delete("/api/projects/*", async (request, reply) => {
    const rest = toPosix((request.params as Record<string, string>)["*"] ?? "");
    if (!rest.endsWith("/files")) {
      reply.code(404);
      return { error: "not found" };
    }
    const query = (request.query ?? {}) as { path?: string };
    if (typeof query.path !== "string" || query.path.length === 0) {
      reply.code(400);
      return { error: "path query parameter is required" };
    }
    await deleteFile(projectsDir, query.path);
    return { ok: true };
  });

  // ---- shared catalog ---------------------------------------------------------------
  fastify.get("/api/catalog", async () => ({ files: await readFilesRecursive(catalogDir) }));

  fastify.put("/api/catalog/files", async (request, reply) => {
    const body = (request.body ?? {}) as PutFilesBody;
    return respondPutResult(await putFiles(catalogDir, body), reply);
  });

  // DELETE /api/catalog/files?path=<relative to catalogDir> — deletes one shared catalog file.
  fastify.delete("/api/catalog/files", async (request, reply) => {
    const query = (request.query ?? {}) as { path?: string };
    if (typeof query.path !== "string" || query.path.length === 0) {
      reply.code(400);
      return { error: "path query parameter is required" };
    }
    await deleteFile(catalogDir, query.path);
    return { ok: true };
  });

  // ---- static SPA ---------------------------------------------------------------
  const webDist = opts.webDist ?? DEFAULT_WEB_DIST;
  if (await pathExists(webDist)) {
    await fastify.register(fastifyStatic, { root: webDist, wildcard: true });
    fastify.setNotFoundHandler((request, reply) => {
      if (request.raw.method === "GET" && !request.url.startsWith("/api/")) {
        reply.sendFile("index.html");
        return;
      }
      reply.code(404).send({ error: "not found" });
    });
  } else {
    fastify.log.info(`static SPA directory not found at ${webDist}; skipping static file serving`);
  }

  return fastify;
}
