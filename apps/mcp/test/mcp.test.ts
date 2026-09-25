/**
 * End-to-end MCP tests: a real MCP client talks to the server over the SDK's in-memory transport,
 * against the bundled simple-link example (read-only tools) and a temp copy of it (edits).
 */
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { examplesDir } from "@lumantite/catalog";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

const simple = join(examplesDir, "simple-link", "project.yaml");
let client: Client;
let tmp: string;

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { type: string; text: string }[])[0]!.text;
  return { isError: !!res.isError, text, json: () => JSON.parse(text) };
}

beforeAll(async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer().connect(a);
  client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  tmp = mkdtempSync(join(tmpdir(), "lumantite-mcp-"));
  cpSync(join(examplesDir, "simple-link"), tmp, { recursive: true });
});

afterAll(async () => {
  await client.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("lumantite mcp", () => {
  it("lists tools and examples", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["check_project", "get_signal", "edit_project", "search_catalog"]));
    const ex = (await call("list_examples")).json();
    expect(ex.map((e: { name: string }) => e.name)).toEqual(expect.arrayContaining(["simple-link", "cwdm-ring", "dwdm-amplified"]));
  });

  it("checks a project", async () => {
    const r = (await call("check_project", { project: simple })).json();
    expect(r.ok).toBe(true);
    expect(r.summary.signals).toBe(2);
    expect(r.signals.every((s: { status: string }) => s.status === "pass")).toBe(true);
  });

  it("returns a link budget for one signal, and suggests ids for unknown ones", async () => {
    const { signals } = (await call("check_project", { project: simple })).json();
    const sig = (await call("get_signal", { project: simple, signal_id: signals[0].id })).json();
    expect(sig.path.length).toBeGreaterThan(2);
    expect(sig.checks.length).toBeGreaterThan(0);
    const bad = await call("get_signal", { project: simple, signal_id: "A-sfp.tx:nope" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("A-sfp.tx");
  });

  it("searches the catalog and resolves models and plans", async () => {
    const r = (await call("search_catalog", { kind: "fibre" })).json();
    expect(r.models.some((m: { id: string }) => m.id === "g652d")).toBe(true);
    expect((await call("get_catalog_model", { id: "generic-10g-lr" })).json().kind).toBe("transceiver");
    expect((await call("get_catalog_model", { id: "cwdm-18" })).json().channels).toHaveLength(18);
    expect((await call("get_catalog_model", { id: "nope" })).isError).toBe(true);
  });

  it("exports markdown", async () => {
    const r = (await call("export_project", { project: simple, format: "md" })).json();
    expect(r.name).toMatch(/\.md$/);
    expect(r.text).toContain("Simple point-to-point link");
  });

  it("edits a project: dry run writes nothing, real run preserves comments, bad ops roll back", async () => {
    const path = join(tmp, "project.yaml");
    const before = readFileSync(path, "utf8");
    const ops = [{ op: "updateFibre", id: "span1", patch: { length_km: 60 } }];

    const dry = (await call("edit_project", { project: path, ops, dry_run: true })).json();
    expect(dry.applied).toBe(true);
    expect(dry.files["project.yaml"]).toContain("length_km: 60");
    expect(readFileSync(path, "utf8")).toBe(before);

    const real = (await call("edit_project", { project: path, ops })).json();
    expect(real.files).toEqual(["project.yaml"]);
    expect(real.after.summary.fail).toBeGreaterThan(0);
    const after = readFileSync(path, "utf8");
    expect(after).toContain("length_km: 60");
    expect(after).toContain("# simple-link: the smallest possible project.");

    const bad = (await call("edit_project", { project: path, ops: [{ op: "deleteNode", id: "no-such-node" }] })).json();
    expect(bad.applied).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(after);
  });

  it("creates a project and refuses to overwrite one", async () => {
    const path = join(tmp, "new", "project.yaml");
    const r = (await call("create_project", { path, name: "New" })).json();
    expect(r.created).toBe(path);
    expect((await call("check_project", { project: path })).json().project).toBe("New");
    const again = await call("create_project", { path, name: "Other" });
    expect(again.isError).toBe(true);
    expect(again.text).toContain("already exists");
  });

  it("reports a missing project as a tool error", async () => {
    const r = await call("check_project", { project: join(tmp, "missing.yaml") });
    expect(r.isError).toBe(true);
  });
});
