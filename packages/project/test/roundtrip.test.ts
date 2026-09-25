import { describe, expect, test } from "vitest";
import { openProject } from "../src/index.js";
import { PROJECT_YAML, SITE_A_YAML, SITE_B_YAML, SPANS_YAML, projectFiles, replaceOnce } from "./fixtures.js";

describe("round-trip identity", () => {
  test("untouched multi-file project serialises byte-identical", () => {
    const files = projectFiles();
    const s = openProject("project.yaml", files);
    expect(s.issues).toEqual([]);
    expect(s.serialize()).toEqual(files);
    expect(s.changedFiles()).toEqual([]);
    expect(s.files()).toEqual(["project.yaml", "sites/a.yaml", "sites/b.yaml", "spans.yaml"]);
  });

  test("an empty batch and a no-op batch change nothing", () => {
    const files = projectFiles();
    const s = openProject("project.yaml", files);
    expect(s.apply([])).toEqual([]);
    expect(s.apply([
      { op: "setLayout", kind: "node", id: "A-mux", rect: { x: 120, y: 80 } },
      { op: "updateFibre", id: "span-AB-1", patch: { length_km: 60 } },
    ])).toEqual([]);
    expect(s.serialize()).toEqual(files);
    expect(s.changedFiles()).toEqual([]);
  });

  test("model: parent first, includes in order, elements tagged with their file, layout merged", () => {
    const s = openProject("project.yaml", projectFiles());
    const m = s.model;
    expect(m.rootFile).toBe("project.yaml");
    expect(m.files).toEqual([
      { path: "project.yaml" },
      { path: "sites/a.yaml", label: "Exchange A" },
      { path: "sites/b.yaml", label: "Exchange B" }, // "./" normalised away
      { path: "spans.yaml", label: "Inter-site spans" },
    ]);
    expect(m.project.name).toBe("Metro ring east");
    expect(m.project.margins?.system_margin_dB).toBe(3);
    expect(m.sites.map((x) => `${x.id}@${x.file}`)).toEqual(["siteA@project.yaml", "siteB@project.yaml"]);
    expect(m.nodes.map((x) => `${x.id}@${x.file}`)).toEqual([
      "A-sw1@sites/a.yaml", "A-sfp-21@sites/a.yaml", "A-mux@sites/a.yaml", "A-amp@sites/a.yaml",
      "B-demux@sites/b.yaml", "B-sfp-21@sites/b.yaml",
    ]);
    expect(m.fibres.map((x) => `${x.id}@${x.file}`)).toEqual([
      "p1@sites/a.yaml", "p2@sites/a.yaml", "p3@sites/b.yaml", "span-AB-1@spans.yaml", "span-AB-2@spans.yaml",
    ]);
    expect(m.nodes.find((n) => n.id === "A-amp")?.settings).toEqual({ mode: "constant_gain", gain_dB: 20 });
    expect(m.fibres.find((f) => f.id === "span-AB-1")?.a).toEqual({ joint: "lc-upc", to: "A-amp.out" });
    expect(m.layout.nodes).toEqual({
      "A-mux": { x: 120, y: 80 }, "A-amp": { x: 260, y: 80 }, "B-demux": { x: 900, y: 80 }, "B-sfp-21": { x: 1040, y: 80 },
    });
    expect(m.layout.sites).toEqual({ siteA: { x: 0, y: 0, w: 400, h: 300 }, siteB: { x: 800, y: 0, w: 400, h: 300 } });
    expect(Object.keys(m.layout.files ?? {})).toEqual(["sites/a.yaml", "sites/b.yaml"]);
  });

  test("fragment layout wins for its own elements; entries for foreign ids in fragments are ignored", () => {
    const files = projectFiles();
    files["sites/b.yaml"] = replaceOnce(SITE_B_YAML, "    B-sfp-21: { x: 1040, y: 80 }\n", "    B-sfp-21: { x: 1040, y: 80 }\n    A-mux: { x: 1, y: 1 }\n");
    files["project.yaml"] = replaceOnce(PROJECT_YAML, "  files:\n", "  nodes: { B-demux: { x: 5, y: 5 }, A-sw1: { x: 7, y: 7 } }\n  files:\n");
    const s = openProject("project.yaml", files);
    expect(s.model.layout.nodes?.["A-mux"]).toEqual({ x: 120, y: 80 });   // from a.yaml, not b.yaml's stray entry
    expect(s.model.layout.nodes?.["B-demux"]).toEqual({ x: 900, y: 80 }); // fragment beats parent
    expect(s.model.layout.nodes?.["A-sw1"]).toEqual({ x: 7, y: 7 });      // parent contributes everything
  });

  test("root file in a sub-directory: storage paths vs model paths", () => {
    const s = openProject("metro/project.yaml", projectFiles("metro/"));
    expect(s.issues).toEqual([]);
    expect(s.files()).toEqual(["metro/project.yaml", "metro/sites/a.yaml", "metro/sites/b.yaml", "metro/spans.yaml"]);
    expect(s.model.files.map((f) => f.path)).toEqual(["metro/project.yaml", "sites/a.yaml", "sites/b.yaml", "spans.yaml"]);
    expect(s.model.nodes[0].file).toBe("sites/a.yaml");
    // ops accept the model path, file APIs accept either
    expect(s.apply([{ op: "setLayout", kind: "node", id: "A-mux", rect: { x: 1, y: 2 } }])).toEqual([]);
    expect(s.changedFiles()).toEqual(["metro/sites/a.yaml"]);
    expect(s.getFileText("sites/a.yaml")).toBe(s.getFileText("metro/sites/a.yaml"));
  });
});

describe("T24 YAML round-trip: move a node, change a length", () => {
  test("only the touched scalars change, across parent and fragments", () => {
    const s = openProject("project.yaml", projectFiles());
    expect(s.apply([
      { op: "setLayout", kind: "node", id: "A-mux", rect: { x: 140, y: 95 } },
      { op: "updateFibre", id: "span-AB-1", patch: { length_km: 61.5 } },
    ])).toEqual([]);
    const out = s.serialize();
    expect(out["project.yaml"]).toBe(PROJECT_YAML);
    expect(out["sites/b.yaml"]).toBe(SITE_B_YAML);
    expect(out["sites/a.yaml"]).toBe(replaceOnce(SITE_A_YAML, "A-mux: { x: 120, y: 80 }", "A-mux: { x: 140, y: 95 }"));
    expect(out["spans.yaml"]).toBe(replaceOnce(SPANS_YAML, "length_km: 60\n", "length_km: 61.5\n"));
    expect(s.changedFiles()).toEqual(["sites/a.yaml", "spans.yaml"]);
    expect(s.model.layout.nodes?.["A-mux"]).toEqual({ x: 140, y: 95 });
    expect(s.model.fibres.find((f) => f.id === "span-AB-1")?.length_km).toBe(61.5);

    s.markSaved();
    expect(s.changedFiles()).toEqual([]);
    // second round on the re-parsed text is just as precise
    s.apply([{ op: "setLayout", kind: "site", id: "siteB", rect: { x: 810, y: 0, w: 400, h: 300 } }]);
    expect(s.changedFiles()).toEqual(["project.yaml"]);
    expect(s.getFileText("project.yaml")).toBe(replaceOnce(PROJECT_YAML, "siteB: { x: 800,", "siteB: { x: 810,"));
  });
});

describe("T24b move between files", () => {
  test("node and its comment leave sites/a.yaml and appear in spans.yaml; nothing else changes", () => {
    const s = openProject("project.yaml", projectFiles());
    expect(s.apply([{ op: "moveToFile", kind: "node", id: "A-sfp-21", file: "spans.yaml" }])).toEqual([]);
    const out = s.serialize();
    expect(s.changedFiles()).toEqual(["sites/a.yaml", "spans.yaml"]);
    expect(out["project.yaml"]).toBe(PROJECT_YAML);
    expect(out["sites/b.yaml"]).toBe(SITE_B_YAML);
    expect(out["sites/a.yaml"]).toBe(replaceOnce(SITE_A_YAML,
      "  # 10G DWDM optic, channel 21\n  - { id: A-sfp-21, model: fs-sfp-10g-dwdm-c21-80km, site: siteA, host: A-sw1, slot: Eth1/1 }\n", ""));
    expect(out["spans.yaml"]).toBe(replaceOnce(SPANS_YAML, "# Inter-site spans\n",
      "# Inter-site spans\nnodes:\n  # 10G DWDM optic, channel 21\n  - { id: A-sfp-21, model: fs-sfp-10g-dwdm-c21-80km, site: siteA, host: A-sw1, slot: Eth1/1 }\n"));

    // ids stay unique and cross-file references still resolve
    expect(s.issues).toEqual([]);
    const m = s.model;
    expect(m.nodes.find((n) => n.id === "A-sfp-21")?.file).toBe("spans.yaml");
    const ids = new Set([...m.nodes.map((n) => n.id), ...m.fibres.map((f) => f.id)]);
    for (const f of m.fibres) for (const end of [f.a, f.b]) {
      if (end.to) expect(ids.has(end.to.slice(0, end.to.lastIndexOf(".")))).toBe(true);
    }
    expect(m.fibres.find((f) => f.id === "p1")?.a.to).toBe("A-sfp-21.tx");
  });

  test("trailing comment and layout entry travel with the node", () => {
    const s = openProject("project.yaml", projectFiles());
    expect(s.apply([{ op: "moveToFile", kind: "node", id: "A-mux", file: "sites/b.yaml" }])).toEqual([]);
    const out = s.serialize();
    expect(out["sites/a.yaml"]).toBe(replaceOnce(
      replaceOnce(SITE_A_YAML, "  - { id: A-mux,  model: generic-dwdm-40ch-100ghz, site: siteA }   # 40ch mux\n", ""),
      "nodes: { A-mux: { x: 120, y: 80 }, A-amp: { x: 260, y: 80 } }", "nodes: { A-amp: { x: 260, y: 80 } }"));
    expect(out["sites/b.yaml"]).toBe(replaceOnce(replaceOnce(SITE_B_YAML,
      "    site: siteB\n\nfibres:", "    site: siteB\n  - { id: A-mux,  model: generic-dwdm-40ch-100ghz, site: siteA }   # 40ch mux\n\nfibres:"),
      "    B-sfp-21: { x: 1040, y: 80 }\n", "    B-sfp-21: { x: 1040, y: 80 }\n    A-mux: { x: 120, y: 80 }\n"));
    expect(s.model.layout.nodes?.["A-mux"]).toEqual({ x: 120, y: 80 });
    expect(s.model.nodes.find((n) => n.id === "A-mux")?.file).toBe("sites/b.yaml");
    expect(s.changedFiles()).toEqual(["sites/a.yaml", "sites/b.yaml"]);
  });

  test("moving back restores the original files", () => {
    const s = openProject("project.yaml", projectFiles());
    s.apply([{ op: "moveToFile", kind: "fibre", id: "p3", file: "spans.yaml" }]);
    expect(s.model.fibres.find((f) => f.id === "p3")?.file).toBe("spans.yaml");
    expect(s.getFileText("spans.yaml")).toBe(SPANS_YAML
      + "  - { id: p3, type: lc-patch, a: { to: B-demux.C21 }, b: { to: B-sfp-21.rx } }\n");
    s.apply([{ op: "moveToFile", kind: "fibre", id: "p3", file: "sites/b.yaml" }]);
    expect(s.serialize()).toEqual(projectFiles());
    expect(s.changedFiles()).toEqual([]);
  });
});

describe("reordering inside one batch", () => {
  test("move out and back in the same batch keeps the text byte-exact apart from the new position", () => {
    const s = openProject("project.yaml", projectFiles());
    expect(s.apply([
      { op: "moveToFile", kind: "node", id: "A-sfp-21", file: "spans.yaml" },
      { op: "moveToFile", kind: "node", id: "A-sfp-21", file: "sites/a.yaml" },
    ])).toEqual([]);
    // it is re-appended at the end of the list, comment and all
    const line = "  # 10G DWDM optic, channel 21\n  - { id: A-sfp-21, model: fs-sfp-10g-dwdm-c21-80km, site: siteA, host: A-sw1, slot: Eth1/1 }\n";
    expect(s.getFileText("sites/a.yaml")).toBe(replaceOnce(replaceOnce(SITE_A_YAML, line, ""),
      "gain_dB: 20 } }\n", "gain_dB: 20 } }\n" + line));
    expect(s.getFileText("spans.yaml")).toBe(SPANS_YAML);
    expect(s.changedFiles()).toEqual(["sites/a.yaml"]);
  });
});
