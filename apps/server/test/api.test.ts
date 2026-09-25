import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppConfig } from "@optiplanner/schema";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/app.js";
import { FileApiError, safeResolve } from "../src/files.js";

let tmpRoot: string;
let projectsDir: string;
let catalogDir: string;
let fastify: FastifyInstance;

async function start(): Promise<void> {
  const config = AppConfig.parse({
    server: { port: 0 },
    paths: { projects: projectsDir, catalog: catalogDir },
  });
  // Point the static SPA lookup at a directory that never exists, so tests are hermetic
  // regardless of whether apps/web has been built yet.
  fastify = await buildServer(config, { webDist: path.join(tmpRoot, "no-such-web-dist"), logger: false });
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "optiplanner-server-test-"));
  projectsDir = path.join(tmpRoot, "projects");
  catalogDir = path.join(tmpRoot, "catalog");
  await fs.mkdir(projectsDir, { recursive: true });
  await fs.mkdir(catalogDir, { recursive: true });
  await start();
});

afterEach(async () => {
  await fastify.close();
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("GET /api/config", () => {
  it("returns the resolved config", async () => {
    const res = await fastify.inject({ method: "GET", url: "/api/config" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.paths.projects).toBe(projectsDir);
    expect(body.paths.catalog).toBe(catalogDir);
    expect(body.server.port).toBeDefined();
  });
});

describe("GET /api/projects (list)", () => {
  it("lists only files with optiplanner: 1 at the top level, reading project.name", async () => {
    await fs.writeFile(
      path.join(projectsDir, "ring.yaml"),
      "optiplanner: 1\nproject:\n  name: Metro ring east\nsites: []\nnodes: []\nfibres: []\n",
    );
    await fs.mkdir(path.join(projectsDir, "sub"), { recursive: true });
    await fs.writeFile(
      path.join(projectsDir, "sub", "other.yaml"),
      "optiplanner: 1\nproject:\n  name: Nested project\n",
    );
    // Not a project file: no `optiplanner: 1` at the top level (e.g. a catalog fragment).
    await fs.writeFile(path.join(projectsDir, "not-a-project.yaml"), "kind: joint\nid: lc-upc\n");

    const res = await fastify.inject({ method: "GET", url: "/api/projects" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; name: string; rootFile: string }[];
    expect(body).toHaveLength(2);
    const byId = Object.fromEntries(body.map((p) => [p.id, p]));
    expect(byId["ring.yaml"].name).toBe("Metro ring east");
    expect(byId["sub/other.yaml"].name).toBe("Nested project");
  });
});

describe("GET /api/projects/:id (project + includes)", () => {
  it("reads the parent plus every include, relative to the parent's directory", async () => {
    await fs.mkdir(path.join(projectsDir, "proj", "sites"), { recursive: true });
    await fs.writeFile(
      path.join(projectsDir, "proj", "project.yaml"),
      [
        "optiplanner: 1",
        "includes:",
        "  - { file: sites/a.yaml, label: Site A }",
        "project:",
        "  name: Demo",
      ].join("\n"),
    );
    await fs.writeFile(path.join(projectsDir, "proj", "sites", "a.yaml"), "nodes: []\n");

    const res = await fastify.inject({ method: "GET", url: "/api/projects/proj/project.yaml" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rootFile: string; files: Record<string, { text: string; etag: string }>; missing?: string[] };
    expect(body.rootFile).toBe("proj/project.yaml");
    expect(Object.keys(body.files).sort()).toEqual(["proj/project.yaml", "proj/sites/a.yaml"]);
    expect(body.files["proj/sites/a.yaml"].text).toBe("nodes: []\n");
    expect(body.missing).toBeUndefined();
  });

  it("reports a missing include in `missing` instead of failing the request", async () => {
    await fs.mkdir(path.join(projectsDir, "proj2"), { recursive: true });
    await fs.writeFile(
      path.join(projectsDir, "proj2", "project.yaml"),
      ["optiplanner: 1", "includes:", "  - { file: gone.yaml }", "project:", "  name: Demo2"].join("\n"),
    );

    const res = await fastify.inject({ method: "GET", url: "/api/projects/proj2/project.yaml" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { missing?: string[] };
    expect(body.missing).toEqual(["proj2/gone.yaml"]);
  });

  it("404s for an unknown project", async () => {
    const res = await fastify.inject({ method: "GET", url: "/api/projects/nope.yaml" });
    expect(res.statusCode).toBe(404);
  });

  it("404s (not 500) for a bogus path nested under an existing project file", async () => {
    await fs.writeFile(path.join(projectsDir, "leaf.yaml"), "optiplanner: 1\nproject:\n  name: Leaf\n");
    const res = await fastify.inject({ method: "GET", url: "/api/projects/leaf.yaml/bogus" });
    expect(res.statusCode).toBe(404);
  });
});

describe("PUT /api/projects/:id/files (etag-guarded save)", () => {
  it("succeeds with a matching etag and returns a new etag", async () => {
    const full = path.join(projectsDir, "p.yaml");
    await fs.writeFile(full, "optiplanner: 1\nproject:\n  name: P\n");
    const get = await fastify.inject({ method: "GET", url: "/api/projects/p.yaml" });
    const etag = get.json().files["p.yaml"].etag as string;

    const newText = "optiplanner: 1\nproject:\n  name: P renamed\n";
    const put = await fastify.inject({
      method: "PUT",
      url: "/api/projects/p.yaml/files",
      payload: { files: { "p.yaml": { text: newText, etag } } },
    });
    expect(put.statusCode).toBe(200);
    const putBody = put.json() as { files: Record<string, { etag: string }> };
    const newEtag = putBody.files["p.yaml"].etag;
    expect(newEtag).not.toBe(etag);

    const onDisk = await fs.readFile(full, "utf8");
    expect(onDisk).toBe(newText);
  });

  it("rejects a stale etag with 409 and the current text", async () => {
    const full = path.join(projectsDir, "p2.yaml");
    await fs.writeFile(full, "optiplanner: 1\nproject:\n  name: P2\n");

    const put = await fastify.inject({
      method: "PUT",
      url: "/api/projects/p2.yaml/files",
      payload: { files: { "p2.yaml": { text: "changed\n", etag: "deadbeef" } } },
    });
    expect(put.statusCode).toBe(409);
    const body = put.json() as { conflicts: string[]; files: Record<string, { text: string; etag: string | null }> };
    expect(body.conflicts).toEqual(["p2.yaml"]);
    expect(body.files["p2.yaml"].text).toBe("optiplanner: 1\nproject:\n  name: P2\n");

    // Nothing was written.
    const onDisk = await fs.readFile(full, "utf8");
    expect(onDisk).toBe("optiplanner: 1\nproject:\n  name: P2\n");
  });

  it("creates a new file when etag is null", async () => {
    const put = await fastify.inject({
      method: "PUT",
      url: "/api/projects/new/created.yaml/files",
      payload: { files: { "new/created.yaml": { text: "nodes: []\n", etag: null } } },
    });
    expect(put.statusCode).toBe(200);
    const onDisk = await fs.readFile(path.join(projectsDir, "new", "created.yaml"), "utf8");
    expect(onDisk).toBe("nodes: []\n");
  });

  it("rejects etag: null when the file already exists (409)", async () => {
    await fs.writeFile(path.join(projectsDir, "exists.yaml"), "a: 1\n");
    const put = await fastify.inject({
      method: "PUT",
      url: "/api/projects/exists.yaml/files",
      payload: { files: { "exists.yaml": { text: "b: 2\n", etag: null } } },
    });
    expect(put.statusCode).toBe(409);
  });
});

describe("path traversal", () => {
  it("rejects a PUT that tries to escape the projects dir with 400", async () => {
    const put = await fastify.inject({
      method: "PUT",
      url: "/api/projects/x/files",
      payload: { files: { "../../../etc/passwd": { text: "pwned\n", etag: null } } },
    });
    expect(put.statusCode).toBe(400);
  });

  // A `..`-laden URL never reaches our route handler at all: fastify/find-my-way normalize the
  // path (WHATWG URL semantics) before matching, so "/api/projects/../../etc/x" 404s upstream
  // rather than exercising our guard. `safeResolve` itself is what actually protects every
  // path that *does* reach a handler (URL params and, as above, JSON body paths), so it is
  // exercised directly here for the traversal forms an inject() call can't produce.
  it("safeResolve rejects '..' traversal and absolute paths with 400", () => {
    expect(() => safeResolve(projectsDir, "../../../etc/passwd")).toThrow(FileApiError);
    expect(() => safeResolve(projectsDir, "sub/../../escape.yaml")).toThrow(FileApiError);
    expect(() => safeResolve(projectsDir, "/etc/passwd")).toThrow(FileApiError);
    try {
      safeResolve(projectsDir, "../escape.yaml");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FileApiError);
      expect((err as FileApiError).statusCode).toBe(400);
    }
  });
});

describe("catalog", () => {
  it("round-trips a file through PUT and GET", async () => {
    const put = await fastify.inject({
      method: "PUT",
      url: "/api/catalog/files",
      payload: { files: { "joints.yaml": { text: "kind: joint\nid: lc-upc\n", etag: null } } },
    });
    expect(put.statusCode).toBe(200);

    const get = await fastify.inject({ method: "GET", url: "/api/catalog" });
    expect(get.statusCode).toBe(200);
    const body = get.json() as { files: Record<string, { text: string; etag: string }> };
    expect(body.files["joints.yaml"].text).toBe("kind: joint\nid: lc-upc\n");
  });
});

describe("project-local catalog", () => {
  it("returns an empty files map when the project has no local catalog/ dir", async () => {
    await fs.writeFile(path.join(projectsDir, "solo.yaml"), "optiplanner: 1\nproject:\n  name: Solo\n");
    const res = await fastify.inject({ method: "GET", url: "/api/projects/solo.yaml/catalog" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ files: {} });
  });

  it("round-trips a project-local catalog file", async () => {
    await fs.writeFile(path.join(projectsDir, "solo2.yaml"), "optiplanner: 1\nproject:\n  name: Solo2\n");
    const put = await fastify.inject({
      method: "PUT",
      url: "/api/projects/solo2.yaml/catalog/files",
      payload: { files: { "amps.yaml": { text: "kind: amplifier\nid: x\n", etag: null } } },
    });
    expect(put.statusCode).toBe(200);

    const get = await fastify.inject({ method: "GET", url: "/api/projects/solo2.yaml/catalog" });
    const body = get.json() as { files: Record<string, { text: string }> };
    expect(body.files["amps.yaml"].text).toBe("kind: amplifier\nid: x\n");

    const onDisk = await fs.readFile(path.join(projectsDir, "catalog", "amps.yaml"), "utf8");
    expect(onDisk).toBe("kind: amplifier\nid: x\n");
  });
});

describe("POST /api/projects (create)", () => {
  it("creates a new project from a minimal parent file", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/api/projects",
      payload: { rootFile: "created/project.yaml", name: "Created Project" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { rootFile: string; files: Record<string, { text: string; etag: string }> };
    expect(body.rootFile).toBe("created/project.yaml");
    const onDisk = await fs.readFile(path.join(projectsDir, "created", "project.yaml"), "utf8");
    expect(onDisk).toContain("optiplanner: 1");
    expect(onDisk).toContain("Created Project");
  });

  it("refuses to overwrite an existing project (409)", async () => {
    await fs.writeFile(path.join(projectsDir, "dup.yaml"), "optiplanner: 1\nproject:\n  name: Dup\n");
    const res = await fastify.inject({
      method: "POST",
      url: "/api/projects",
      payload: { rootFile: "dup.yaml", name: "Dup" },
    });
    expect(res.statusCode).toBe(409);
  });
});
