import { describe, expect, test } from "vitest";
import { newProjectText, openProject } from "../src/index.js";
import { PROJECT_YAML, SITE_A_YAML, SITE_B_YAML, projectFiles, replaceOnce } from "./fixtures.js";

describe("missing include", () => {
  test("issue project.file_unknown, project still opens with the file listed and empty", () => {
    const files = projectFiles();
    delete files["spans.yaml"];
    const s = openProject("project.yaml", files);
    expect(s.issues).toEqual([
      expect.objectContaining({ severity: "error", code: "project.file_unknown", element: "spans.yaml" }),
    ]);
    expect(s.files()).toEqual(["project.yaml", "sites/a.yaml", "sites/b.yaml", "spans.yaml"]);
    expect(s.model.files.map((f) => f.path)).toContain("spans.yaml");
    expect(s.model.fibres.map((f) => f.id)).toEqual(["p1", "p2", "p3"]);
    expect(s.getFileText("spans.yaml")).toBe("");
    expect(Object.keys(s.serialize())).toEqual(["project.yaml", "sites/a.yaml", "sites/b.yaml"]);
    expect(s.changedFiles()).toEqual([]);

    // writing into it creates it
    expect(s.apply([{ op: "addFibre", file: "spans.yaml", fibre: { id: "s1", type: "g652d", length_km: 5 } }])).toEqual([]);
    expect(s.getFileText("spans.yaml")).toBe("fibres:\n  - id: s1\n    type: g652d\n    length_km: 5\n");
    expect(s.changedFiles()).toEqual(["spans.yaml"]);
    expect(s.issues).toEqual([]);
  });

  test("missing root file", () => {
    const s = openProject("nope.yaml", {});
    expect(s.issues.map((i) => i.code)).toContain("project.file_unknown");
    expect(s.model.nodes).toEqual([]);
  });
});

describe("duplicate ids and schema problems", () => {
  test("duplicate ids across files → project.duplicate_id", () => {
    const files = projectFiles();
    files["sites/b.yaml"] = replaceOnce(SITE_B_YAML, "  - id: B-sfp-21\n", "  - id: A-mux\n");
    files["project.yaml"] = replaceOnce(PROJECT_YAML, "{ id: siteB,", "{ id: siteA,");
    const s = openProject("project.yaml", files);
    expect(s.issues).toEqual([
      expect.objectContaining({ code: "project.duplicate_id", element: "A-mux", severity: "error" }),
      expect.objectContaining({ code: "project.duplicate_id", element: "siteA", severity: "error" }),
    ]);
    expect(s.issues[0].message).toContain("sites/a.yaml");
    expect(s.issues[0].message).toContain("sites/b.yaml");
  });

  test("schema failures: readable message anchored to the file, valid elements still load", () => {
    const files = projectFiles();
    files["sites/a.yaml"] = replaceOnce(SITE_A_YAML, "{ id: A-mux,  model: generic-dwdm-40ch-100ghz, site: siteA }", "{ id: A-mux, site: siteA }");
    files["spans.yaml"] = files["spans.yaml"].replace("length_km: 20", "length_km: -3");
    const s = openProject("project.yaml", files);
    const schema = s.issues.filter((i) => i.code === "project.schema_error");
    expect(schema).toHaveLength(2);
    expect(schema[0]).toMatchObject({ element: "sites/a.yaml", severity: "error" });
    expect(schema[0].message).toMatch(/^sites\/a\.yaml: nodes\[2\] \(A-mux\)\.model: /);
    expect(schema[1]).toMatchObject({ element: "spans.yaml" });
    expect(schema[1].message).toContain("fibres[1] (span-AB-2).length_km");
    expect(s.model.nodes.map((n) => n.id)).toEqual(["A-sw1", "A-sfp-21", "A-amp", "B-demux", "B-sfp-21"]);
    expect(s.model.fibres.map((n) => n.id)).toEqual(["p1", "p2", "p3", "span-AB-1"]);
    // layout of a partially invalid file is still used
    expect(s.model.layout.nodes?.["A-amp"]).toEqual({ x: 260, y: 80 });
  });

  test("parent with a broken project block still opens", () => {
    const s = openProject("p.yaml", { "p.yaml": "optiplanner: 2\nproject: { description: 3 }\nnodes:\n  - { id: n1, model: m }\n" });
    expect(s.issues.every((i) => i.code === "project.schema_error" && i.element === "p.yaml")).toBe(true);
    expect(s.issues.length).toBeGreaterThanOrEqual(2);
    expect(s.model.nodes.map((n) => n.id)).toEqual(["n1"]);
  });
});

describe("setFileText", () => {
  test("parse error → project.parse_error issue; model keeps the last good content; fixing clears it", () => {
    const s = openProject("project.yaml", projectFiles());
    const broken = "nodes:\n  - { id: B-demux, model: x\n  - id: [\n";
    const issues = s.setFileText("sites/b.yaml", broken);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.code === "project.parse_error" && i.element === "sites/b.yaml" && i.severity === "error")).toBe(true);
    expect(issues[0].values).toHaveProperty("line");
    expect(s.getFileText("sites/b.yaml")).toBe(broken);
    expect(s.changedFiles()).toEqual(["sites/b.yaml"]);
    expect(s.model.nodes.filter((n) => n.file === "sites/b.yaml").map((n) => n.id)).toEqual(["B-demux", "B-sfp-21"]);

    // ops touching that file are refused, others still work
    expect(s.apply([{ op: "updateNode", id: "B-demux", patch: { name: "x" } }]).map((i) => i.code)).toEqual(["project.parse_error"]);
    expect(s.apply([{ op: "updateNode", id: "A-mux", patch: { name: "x" } }])).toEqual([]);
    expect(s.getFileText("sites/b.yaml")).toBe(broken);

    const fixed = "nodes:\n  - { id: B-demux, model: x }\n";
    expect(s.setFileText("sites/b.yaml", fixed)).toEqual([]);
    expect(s.issues.filter((i) => i.code === "project.parse_error")).toEqual([]);
    expect(s.model.nodes.filter((n) => n.file === "sites/b.yaml").map((n) => n.id)).toEqual(["B-demux"]);
    expect(s.getFileText("sites/b.yaml")).toBe(fixed);
  });

  test("editing the parent's includes re-derives the file list", () => {
    const s = openProject("project.yaml", projectFiles());
    const p2 = PROJECT_YAML.replace("  - { file: spans.yaml,     label: Inter-site spans }\n", "");
    expect(s.setFileText("project.yaml", p2)).toEqual([]);
    expect(s.files()).toEqual(["project.yaml", "sites/a.yaml", "sites/b.yaml"]);
    expect(s.model.fibres.some((f) => f.file === "spans.yaml")).toBe(false);
    expect(s.setFileText("project.yaml", PROJECT_YAML)).toEqual([]);
    expect(s.files()).toContain("spans.yaml");
    expect(s.changedFiles()).toEqual([]);
  });

  test("unknown file", () => {
    const s = openProject("project.yaml", projectFiles());
    expect(s.setFileText("other.yaml", "x: 1").map((i) => i.code)).toEqual(["project.file_unknown"]);
  });

  test("then ops keep the text typed in the editor byte-exact", () => {
    const s = openProject("project.yaml", projectFiles());
    const typed = SITE_B_YAML.replace("# Exchange B — receive side", "# Exchange B — receive side (edited)   ");
    s.setFileText("sites/b.yaml", typed);
    s.apply([{ op: "setLayout", kind: "node", id: "B-demux", rect: { x: 1, y: 2 } }]);
    expect(s.getFileText("sites/b.yaml")).toBe(typed.replace("B-demux: { x: 900, y: 80 }", "B-demux: { x: 1, y: 2 }"));
  });
});

describe("newProjectText", () => {
  test("opens cleanly", () => {
    const t = newProjectText("Ring: west");
    const s = openProject("ring/project.yaml", { "ring/project.yaml": t });
    expect(s.issues).toEqual([]);
    expect(s.model.project.name).toBe("Ring: west");
    expect(s.apply([
      { op: "addSite", file: "ring/project.yaml", site: { id: "s1" } },
      { op: "addNode", file: "ring/project.yaml", node: { id: "n1", model: "m", site: "s1" }, position: { x: 0, y: 0 } },
    ])).toEqual([]);
    expect(s.getFileText("ring/project.yaml")).toBe(`optiplanner: 1
project:
  name: "Ring: west"
sites:
  - id: s1
nodes:
  - id: n1
    model: m
    site: s1
fibres: []
layout:
  nodes:
    n1: { x: 0, y: 0 }
`);
  });
});
