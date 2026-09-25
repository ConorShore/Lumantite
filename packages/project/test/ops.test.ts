import { describe, expect, test } from "vitest";
import { openProject } from "../src/index.js";
import type { ProjectSession } from "../src/index.js";
import { PROJECT_YAML, SITE_A_YAML, SITE_B_YAML, SPANS_YAML, projectFiles, replaceOnce } from "./fixtures.js";

const open = () => openProject("project.yaml", projectFiles());
const text = (s: ProjectSession, f: string) => s.getFileText(f);
const untouched = (s: ProjectSession, ...files: string[]) => {
  const orig = projectFiles();
  for (const f of files) expect(text(s, f)).toBe(orig[f]);
};

describe("addNode / addFibre / addSite", () => {
  test("addNode appends a block map to a block list, with layout", () => {
    const s = open();
    expect(s.apply([{ op: "addNode", file: "sites/b.yaml", node: { id: "B-voa", model: "voa", site: "siteB", settings: { setting_dB: 5 } }, position: { x: 950, y: 200 } }])).toEqual([]);
    expect(text(s, "sites/b.yaml")).toBe(replaceOnce(replaceOnce(SITE_B_YAML,
      "    site: siteB\n\nfibres:", "    site: siteB\n  - id: B-voa\n    model: voa\n    site: siteB\n    settings: { setting_dB: 5 }\n\nfibres:"),
      "    B-sfp-21: { x: 1040, y: 80 }\n", "    B-sfp-21: { x: 1040, y: 80 }\n    B-voa: { x: 950, y: 200 }\n"));
    expect(s.changedFiles()).toEqual(["sites/b.yaml"]);
    expect(s.model.nodes.find((n) => n.id === "B-voa")).toEqual({ id: "B-voa", model: "voa", site: "siteB", settings: { setting_dB: 5 }, file: "sites/b.yaml" });
  });

  test("addNode matches flow-style neighbours; key order is canonical; `file` is ignored", () => {
    const s = open();
    const node = { site: "siteA", model: "voa", id: "A-voa", file: "whatever" } as never;
    expect(s.apply([{ op: "addNode", file: "sites/a.yaml", node, position: { x: 1, y: 2 } }])).toEqual([]);
    expect(text(s, "sites/a.yaml")).toBe(replaceOnce(replaceOnce(SITE_A_YAML,
      "gain_dB: 20 } }\n", "gain_dB: 20 } }\n  - { id: A-voa, model: voa, site: siteA }\n"),
      "A-amp: { x: 260, y: 80 } }", "A-amp: { x: 260, y: 80 }, A-voa: { x: 1, y: 2 } }"));
  });

  test("addNode rejects duplicate ids (also against fibres), bad ids, invalid nodes and unknown files", () => {
    const s = open();
    const cases = [
      [{ op: "addNode", file: "sites/a.yaml", node: { id: "A-mux", model: "x" } }, "project.duplicate_id"],
      [{ op: "addNode", file: "sites/a.yaml", node: { id: "span-AB-1", model: "x" } }, "project.duplicate_id"],
      [{ op: "addNode", file: "sites/a.yaml", node: { id: "a.b", model: "x" } }, "project.invalid_op"],
      [{ op: "addNode", file: "sites/a.yaml", node: { id: "n1" } }, "project.invalid_op"],
      [{ op: "addNode", file: "nope.yaml", node: { id: "n1", model: "x" } }, "project.file_unknown"],
    ] as const;
    for (const [op, code] of cases) {
      const issues = s.apply([op as never]);
      expect(issues.map((i) => i.code)).toEqual([code]);
    }
    expect(s.serialize()).toEqual(projectFiles());
  });

  test("addFibre appends to a block list; empty ends are omitted, nested maps are flow", () => {
    const s = open();
    expect(s.apply([{ op: "addFibre", file: "spans.yaml", fibre: {
      id: "span-AB-3", type: "g652d", length_km: 12, a: { joint: "lc-upc", to: "A-amp.out" }, b: {},
    } }])).toEqual([]);
    expect(text(s, "spans.yaml")).toBe(SPANS_YAML
      + "  - id: span-AB-3\n    type: g652d\n    length_km: 12\n    a: { joint: lc-upc, to: A-amp.out }\n");
    expect(s.model.fibres.find((f) => f.id === "span-AB-3")?.b).toEqual({});
  });

  test("addSite with a rect writes the layout into the same file", () => {
    const s = open();
    expect(s.apply([{ op: "addSite", file: "project.yaml", site: { id: "siteC", name: "Hut C" }, rect: { x: 0, y: 400, w: 200, h: 100 } }])).toEqual([]);
    expect(text(s, "project.yaml")).toBe(replaceOnce(replaceOnce(PROJECT_YAML,
      "# receive end\n", "# receive end\n  - { id: siteC, name: Hut C }\n"),
      "siteB: { x: 800, y: 0, w: 400, h: 300 } }", "siteB: { x: 800, y: 0, w: 400, h: 300 }, siteC: { x: 0, y: 400, w: 200, h: 100 } }"));
    expect(s.model.layout.sites?.siteC).toEqual({ x: 0, y: 400, w: 200, h: 100 });
  });
});

describe("updateNode / updateFibre / updateSite", () => {
  test("updateNode patches keys in place; undefined deletes; nested settings merge minimally", () => {
    const s = open();
    expect(s.apply([
      { op: "updateNode", id: "A-amp", patch: { settings: { mode: "constant_gain", gain_dB: 23 } } },
      { op: "updateNode", id: "A-sfp-21", patch: { slot: undefined, name: "Optic 21" } },
    ])).toEqual([]);
    expect(text(s, "sites/a.yaml")).toBe(replaceOnce(replaceOnce(SITE_A_YAML,
      "gain_dB: 20 }", "gain_dB: 23 }"),
      "host: A-sw1, slot: Eth1/1 }", "host: A-sw1, name: Optic 21 }"));
    untouched(s, "project.yaml", "sites/b.yaml", "spans.yaml");
  });

  test("updateNode in a block map keeps comments and adds keys at the end", () => {
    const s = open();
    expect(s.apply([{ op: "updateNode", id: "B-demux", patch: { model: "generic-dwdm-80ch-50ghz", name: "Demux B" } }])).toEqual([]);
    expect(text(s, "sites/b.yaml")).toBe(replaceOnce(SITE_B_YAML,
      "    model: generic-dwdm-40ch-100ghz   # same model as the mux\n    site: siteB\n",
      "    model: generic-dwdm-80ch-50ghz   # same model as the mux\n    site: siteB\n    name: Demux B\n"));
  });

  test("updateNode refuses id changes, invalid results and unknown ids", () => {
    const s = open();
    expect(s.apply([{ op: "updateNode", id: "A-mux", patch: { id: "X" } }])[0].code).toBe("project.invalid_op");
    expect(s.apply([{ op: "updateNode", id: "A-mux", patch: { model: undefined } }])[0].code).toBe("project.invalid_op");
    expect(s.apply([{ op: "updateNode", id: "nope", patch: { name: "x" } }])[0].code).toBe("project.invalid_op");
    expect(s.serialize()).toEqual(projectFiles());
  });

  test("updateFibre merges a/b one level: {a: {to}} keeps a.joint", () => {
    const s = open();
    expect(s.apply([{ op: "updateFibre", id: "span-AB-1", patch: { a: { to: "A-amp.out2" }, extra_loss_dB: 0.5 } }])).toEqual([]);
    expect(text(s, "spans.yaml")).toBe(replaceOnce(SPANS_YAML,
      "    a: { joint: lc-upc,        to: A-amp.out }\n    b: { joint: fusion-splice, to: span-AB-2.a }\n",
      "    a: { joint: lc-upc,        to: A-amp.out2 }\n    b: { joint: fusion-splice, to: span-AB-2.a }\n    extra_loss_dB: 0.5\n"));
    expect(s.model.fibres.find((f) => f.id === "span-AB-1")?.a).toEqual({ joint: "lc-upc", to: "A-amp.out2" });
  });

  test("updateFibre: undefined inside an end deletes that key, missing end is created", () => {
    const s = open();
    s.apply([{ op: "addFibre", file: "spans.yaml", fibre: { id: "f9", type: "g652d", a: {}, b: {} } }]);
    s.markSaved();
    expect(s.apply([
      { op: "updateFibre", id: "span-AB-2", patch: { b: { joint: undefined } } },
      { op: "updateFibre", id: "f9", patch: { a: { to: "A-amp.out" } } },
    ])).toEqual([]);
    expect(text(s, "spans.yaml")).toBe(replaceOnce(SPANS_YAML,
      "    b: { joint: lc-upc,        to: B-demux.common }\n", "    b: { to: B-demux.common }\n")
      + "  - id: f9\n    type: g652d\n    a: { to: A-amp.out }\n");
  });

  test("updateSite", () => {
    const s = open();
    expect(s.apply([{ op: "updateSite", id: "siteB", patch: { name: "Exchange B (north)", description: "rack 4" } }])).toEqual([]);
    expect(text(s, "project.yaml")).toBe(replaceOnce(PROJECT_YAML,
      "{ id: siteB, name: Exchange B }", "{ id: siteB, name: Exchange B (north), description: rack 4 }"));
  });
});

describe("delete ops", () => {
  test("deleteNode removes the item (+ its comment), its layout entry and detaches fibre ends across files", () => {
    const s = open();
    expect(s.apply([{ op: "deleteNode", id: "B-demux" }])).toEqual([]);
    expect(text(s, "sites/b.yaml")).toBe(replaceOnce(replaceOnce(replaceOnce(SITE_B_YAML,
      "  - id: B-demux\n    model: generic-dwdm-40ch-100ghz   # same model as the mux\n    site: siteB\n", ""),
      "a: { to: B-demux.C21 }", "a: {}"),
      "    B-demux: { x: 900, y: 80 }\n", ""));
    expect(text(s, "spans.yaml")).toBe(replaceOnce(SPANS_YAML, "b: { joint: lc-upc,        to: B-demux.common }", "b: { joint: lc-upc }"));
    untouched(s, "project.yaml", "sites/a.yaml");
    expect(s.changedFiles()).toEqual(["sites/b.yaml", "spans.yaml"]);
  });

  test("deleteNode with a comment line above", () => {
    const s = open();
    expect(s.apply([{ op: "deleteNode", id: "A-sfp-21" }])).toEqual([]);
    expect(text(s, "sites/a.yaml")).toBe(replaceOnce(replaceOnce(SITE_A_YAML,
      "  # 10G DWDM optic, channel 21\n  - { id: A-sfp-21, model: fs-sfp-10g-dwdm-c21-80km, site: siteA, host: A-sw1, slot: Eth1/1 }\n", ""),
      "a: { to: A-sfp-21.tx }", "a: {}"));
  });

  test("deleteFibre clears the far end's `to` on the other fibre", () => {
    const s = open();
    expect(s.apply([{ op: "deleteFibre", id: "span-AB-2" }])).toEqual([]);
    expect(text(s, "spans.yaml")).toBe(`# Inter-site spans
fibres:
  # 60 km to the splice point
  - id: span-AB-1
    type: g652d
    length_km: 60
    a: { joint: lc-upc,        to: A-amp.out }
    b: { joint: fusion-splice }
`);
  });

  test("deleteSite removes site keys from nodes and the layout entry", () => {
    const s = open();
    expect(s.apply([{ op: "deleteSite", id: "siteB" }])).toEqual([]);
    expect(text(s, "project.yaml")).toBe(replaceOnce(replaceOnce(PROJECT_YAML,
      "  - { id: siteB, name: Exchange B }   # receive end\n", ""),
      ", siteB: { x: 800, y: 0, w: 400, h: 300 }", ""));
    expect(text(s, "sites/b.yaml")).toBe(SITE_B_YAML.replace(/\n    site: siteB/g, ""));
    expect(s.model.nodes.filter((n) => n.site === "siteB")).toEqual([]);
  });

  test("deleting an unknown element is an issue and changes nothing", () => {
    const s = open();
    expect(s.apply([{ op: "deleteFibre", id: "zzz" }]).map((i) => i.code)).toEqual(["project.invalid_op"]);
    expect(s.changedFiles()).toEqual([]);
  });
});

describe("renameId", () => {
  test("node: rewrites fibre ends in every file, host references and layout keys", () => {
    const s = open();
    expect(s.apply([
      { op: "renameId", kind: "node", from: "A-mux", to: "A-mux1" },
      { op: "renameId", kind: "node", from: "A-sw1", to: "A-sw9" },
      { op: "renameId", kind: "node", from: "A-amp", to: "A-boost" },
    ])).toEqual([]);
    expect(text(s, "sites/a.yaml")).toBe(SITE_A_YAML
      .replace("{ id: A-sw1,", "{ id: A-sw9,").replace("host: A-sw1", "host: A-sw9")
      .replace("{ id: A-mux,", "{ id: A-mux1,").replace("A-mux.C21", "A-mux1.C21").replace("A-mux.common", "A-mux1.common")
      .replace("{ A-mux: { x", "{ A-mux1: { x")
      .replace("{ id: A-amp,", "{ id: A-boost,").replace("A-amp.in", "A-boost.in").replace("A-amp: { x", "A-boost: { x"));
    expect(text(s, "spans.yaml")).toBe(replaceOnce(SPANS_YAML, "to: A-amp.out", "to: A-boost.out"));
    untouched(s, "project.yaml", "sites/b.yaml");
  });

  test("fibre: rewrites fibre-to-fibre references", () => {
    const s = open();
    expect(s.apply([{ op: "renameId", kind: "fibre", from: "span-AB-1", to: "span-1" }])).toEqual([]);
    expect(text(s, "spans.yaml")).toBe(replaceOnce(replaceOnce(SPANS_YAML, "id: span-AB-1", "id: span-1"), "to: span-AB-1.b", "to: span-1.b"));
  });

  test("site: rewrites node site keys and layout keys", () => {
    const s = open();
    expect(s.apply([{ op: "renameId", kind: "site", from: "siteA", to: "exA" }])).toEqual([]);
    expect(text(s, "project.yaml")).toBe(replaceOnce(replaceOnce(PROJECT_YAML, "{ id: siteA,", "{ id: exA,"), "{ siteA: { x: 0", "{ exA: { x: 0"));
    expect(text(s, "sites/a.yaml")).toBe(SITE_A_YAML.replace(/site: siteA/g, "site: exA"));
    expect(s.model.nodes.filter((n) => n.site === "exA")).toHaveLength(4);
  });

  test("rename onto an existing id is refused", () => {
    const s = open();
    expect(s.apply([{ op: "renameId", kind: "node", from: "A-mux", to: "p1" }]).map((i) => i.code)).toEqual(["project.duplicate_id"]);
    expect(s.changedFiles()).toEqual([]);
  });
});

describe("moveToFile", () => {
  test("site moves with its layout entry; target list created in the parent's order", () => {
    const s = open();
    expect(s.apply([{ op: "moveToFile", kind: "site", id: "siteB", file: "sites/b.yaml" }])).toEqual([]);
    expect(text(s, "project.yaml")).toBe(replaceOnce(replaceOnce(PROJECT_YAML,
      "  - { id: siteB, name: Exchange B }   # receive end\n", ""),
      ", siteB: { x: 800, y: 0, w: 400, h: 300 }", ""));
    expect(text(s, "sites/b.yaml")).toBe(replaceOnce(replaceOnce(SITE_B_YAML,
      "# Exchange B — receive side\n", "# Exchange B — receive side\nsites:\n  - { id: siteB, name: Exchange B }   # receive end\n"),
      "    B-sfp-21: { x: 1040, y: 80 }\n", "    B-sfp-21: { x: 1040, y: 80 }\n  sites:\n    siteB: { x: 800, y: 0, w: 400, h: 300 }\n"));
    expect(s.model.sites.find((x) => x.id === "siteB")?.file).toBe("sites/b.yaml");
    expect(s.model.layout.sites?.siteB).toEqual({ x: 800, y: 0, w: 400, h: 300 });
  });

  test("into a new fragment created by addFile (`nodes: []` becomes a block list)", () => {
    const s = open();
    expect(s.apply([
      { op: "addFile", file: "sites/c.yaml", label: "Hut C" },
      { op: "moveToFile", kind: "node", id: "B-sfp-21", file: "sites/c.yaml" },
    ])).toEqual([]);
    expect(text(s, "sites/c.yaml")).toBe(`# Hut C
nodes:
  - id: B-sfp-21
    model: fs-sfp-10g-dwdm-c21-80km
    site: siteB
fibres: []
layout:
  nodes:
    B-sfp-21: { x: 1040, y: 80 }
`);
    expect(s.changedFiles()).toEqual(["project.yaml", "sites/b.yaml", "sites/c.yaml"]);
    expect(s.model.files.map((f) => f.path)).toEqual(["project.yaml", "sites/a.yaml", "sites/b.yaml", "spans.yaml", "sites/c.yaml"]);
  });

  test("to an unknown file is refused", () => {
    const s = open();
    expect(s.apply([{ op: "moveToFile", kind: "node", id: "A-mux", file: "x.yaml" }]).map((i) => i.code)).toEqual(["project.file_unknown"]);
  });
});

describe("setLayout / setMargins / setProjectMeta", () => {
  test("setLayout for a node without an entry adds one to the node's own file", () => {
    const s = open();
    expect(s.apply([{ op: "setLayout", kind: "node", id: "A-sw1", rect: { x: 10, y: 20 } }])).toEqual([]);
    expect(text(s, "sites/a.yaml")).toBe(replaceOnce(SITE_A_YAML, "A-amp: { x: 260, y: 80 } }", "A-amp: { x: 260, y: 80 }, A-sw1: { x: 10, y: 20 } }"));
  });

  test("setLayout for a file goes to the parent; for a site, x/y only keeps w/h", () => {
    const s = open();
    expect(s.apply([
      { op: "setLayout", kind: "file", id: "spans.yaml", rect: { x: 400, y: -40, w: 380, h: 100 } },
      { op: "setLayout", kind: "site", id: "siteA", rect: { x: 5, y: 6 } },
    ])).toEqual([]);
    expect(text(s, "project.yaml")).toBe(replaceOnce(replaceOnce(PROJECT_YAML,
      "    sites/b.yaml: { x: 780, y: -20, w: 440, h: 340 }\n",
      "    sites/b.yaml: { x: 780, y: -20, w: 440, h: 340 }\n    spans.yaml: { x: 400, y: -40, w: 380, h: 100 }\n"),
      "siteA: { x: 0, y: 0,", "siteA: { x: 5, y: 6,"));
  });

  test("setLayout for a site/file without a size needs w and h", () => {
    const s = open();
    expect(s.apply([{ op: "setLayout", kind: "file", id: "spans.yaml", rect: { x: 1, y: 1 } }]).map((i) => i.code)).toEqual(["project.invalid_op"]);
  });

  test("setMargins touches only the parent and only the changed lines", () => {
    const s = open();
    expect(s.apply([{ op: "setMargins", margins: {
      system_margin_dB: 2.5, ageing_dB: 1.0, repair_splices: 3, repair_splice_loss_dB: 0.1,
      connector_ageing_dB: 0, cd_margin_pct: 10,
    } }])).toEqual([]);
    expect(text(s, "project.yaml")).toBe(replaceOnce(replaceOnce(replaceOnce(PROJECT_YAML,
      "system_margin_dB: 3.0", "system_margin_dB: 2.5"),
      "repair_splices: 2", "repair_splices: 3"),
      "    max_channel_imbalance_dB: 6\n", ""));
    expect(s.changedFiles()).toEqual(["project.yaml"]);
    expect(s.model.project.margins).toEqual({
      system_margin_dB: 2.5, ageing_dB: 1, repair_splices: 3, repair_splice_loss_dB: 0.1, connector_ageing_dB: 0, cd_margin_pct: 10,
    });
  });

  test("setMargins validates", () => {
    const s = open();
    expect(s.apply([{ op: "setMargins", margins: { repair_splices: -1 } }]).map((i) => i.code)).toEqual(["project.invalid_op"]);
  });

  test("setProjectMeta", () => {
    const s = open();
    expect(s.apply([{ op: "setProjectMeta", patch: { name: "Metro ring east (v2)", description: "Phase 2", wavelength_plans: ["dwdm-c-100ghz-40", "cwdm-18"] } }])).toEqual([]);
    expect(text(s, "project.yaml")).toBe(replaceOnce(replaceOnce(PROJECT_YAML,
      "  name: Metro ring east\n", "  name: Metro ring east (v2)\n"),
      "    max_channel_imbalance_dB: 6\n", "    max_channel_imbalance_dB: 6\n  description: Phase 2\n")
      .replace("[dwdm-c-100ghz-40]", "[ dwdm-c-100ghz-40, cwdm-18 ]"));
    expect(s.apply([{ op: "setProjectMeta", patch: { name: undefined } }]).map((i) => i.code)).toEqual(["project.invalid_op"]);
  });
});

describe("addFile / removeFile", () => {
  test("addFile creates an empty fragment and an includes entry matching its neighbours", () => {
    const s = open();
    expect(s.apply([{ op: "addFile", file: "./sites/c.yaml", label: "Hut C" }])).toEqual([]);
    expect(s.files()).toContain("sites/c.yaml");
    expect(text(s, "sites/c.yaml")).toBe("# Hut C\nnodes: []\nfibres: []\n");
    expect(text(s, "project.yaml")).toBe(replaceOnce(PROJECT_YAML,
      "  - { file: spans.yaml,     label: Inter-site spans }\n",
      "  - { file: spans.yaml,     label: Inter-site spans }\n  - { file: sites/c.yaml, label: Hut C }\n"));
    expect(s.changedFiles()).toEqual(["project.yaml", "sites/c.yaml"]);
    expect(s.issues).toEqual([]);
    expect(s.apply([{ op: "addFile", file: "sites/c.yaml" }]).map((i) => i.code)).toEqual(["project.invalid_op"]);
  });

  test("addFile without label uses the path as the header comment and omits label", () => {
    const s = openProject("p.yaml", { "p.yaml": "lumantite: 1\nproject: { name: X }\n" });
    expect(s.apply([{ op: "addFile", file: "frag.yaml" }])).toEqual([]);
    expect(text(s, "frag.yaml")).toBe("# frag.yaml\nnodes: []\nfibres: []\n");
    expect(text(s, "p.yaml")).toBe("lumantite: 1\nincludes:\n  - { file: frag.yaml }\nproject: { name: X }\n");
  });

  test("removeFile refuses while the fragment holds elements, then works once empty", () => {
    const s = open();
    const issues = s.apply([{ op: "removeFile", file: "spans.yaml" }]);
    expect(issues.map((i) => i.code)).toEqual(["project.invalid_op"]);
    expect(s.changedFiles()).toEqual([]);
    expect(s.apply([
      { op: "moveToFile", kind: "fibre", id: "span-AB-1", file: "project.yaml" },
      { op: "moveToFile", kind: "fibre", id: "span-AB-2", file: "project.yaml" },
      { op: "removeFile", file: "spans.yaml" },
    ])).toEqual([]);
    expect(s.files()).toEqual(["project.yaml", "sites/a.yaml", "sites/b.yaml"]);
    expect(text(s, "project.yaml")).toContain("  - id: span-AB-1\n    type: g652d\n");
    expect(text(s, "project.yaml")).not.toContain("spans.yaml");
    expect(s.model.fibres.filter((f) => f.file === "project.yaml").map((f) => f.id)).toEqual(["span-AB-1", "span-AB-2"]);
  });

  test("removeFile drops the parent's layout.files entry", () => {
    const s = open();
    s.apply([{ op: "addFile", file: "sites/c.yaml" }, { op: "setLayout", kind: "file", id: "sites/c.yaml", rect: { x: 0, y: 0, w: 1, h: 1 } }]);
    expect(text(s, "project.yaml")).toContain("sites/c.yaml: { x: 0, y: 0, w: 1, h: 1 }");
    expect(s.apply([{ op: "removeFile", file: "sites/c.yaml" }])).toEqual([]);
    expect(text(s, "project.yaml")).toBe(PROJECT_YAML);
  });
});

describe("atomicity", () => {
  test("a failing op anywhere in the batch applies nothing", () => {
    const s = open();
    const issues = s.apply([
      { op: "setLayout", kind: "node", id: "A-mux", rect: { x: 1, y: 1 } },
      { op: "addFile", file: "sites/c.yaml" },
      { op: "deleteNode", id: "does-not-exist" },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "project.invalid_op", element: "does-not-exist" });
    expect(s.serialize()).toEqual(projectFiles());
    expect(s.files()).toEqual(["project.yaml", "sites/a.yaml", "sites/b.yaml", "spans.yaml"]);
    expect(s.model.layout.nodes?.["A-mux"]).toEqual({ x: 120, y: 80 });
    // the session is still usable afterwards
    expect(s.apply([{ op: "setLayout", kind: "node", id: "A-mux", rect: { x: 1, y: 1 } }])).toEqual([]);
    expect(s.changedFiles()).toEqual(["sites/a.yaml"]);
  });

  test("later ops see earlier ops of the same batch", () => {
    const s = open();
    expect(s.apply([
      { op: "addNode", file: "spans.yaml", node: { id: "ila", model: "edfa-ila" } },
      { op: "updateNode", id: "ila", patch: { name: "In-line amp" } },
      { op: "setLayout", kind: "node", id: "ila", rect: { x: 500, y: 100 } },
    ])).toEqual([]);
    expect(text(s, "spans.yaml")).toBe(replaceOnce(SPANS_YAML, "# Inter-site spans\n",
      "# Inter-site spans\nnodes:\n  - id: ila\n    model: edfa-ila\n    name: In-line amp\n")
      + "layout:\n  nodes:\n    ila: { x: 500, y: 100 }\n");
  });
});

describe("edge shapes", () => {
  test("emptying a block list whose first item carries a comment leaves `key: []`", () => {
    const s = open();
    expect(s.apply([
      { op: "moveToFile", kind: "fibre", id: "span-AB-1", file: "project.yaml" },
      { op: "moveToFile", kind: "fibre", id: "span-AB-2", file: "project.yaml" },
    ])).toEqual([]);
    expect(text(s, "spans.yaml")).toBe("# Inter-site spans\nfibres: []\n");
    expect(text(s, "project.yaml")).toBe(replaceOnce(PROJECT_YAML, "\nlayout:", `fibres:
  # 60 km to the splice point
  - id: span-AB-1
    type: g652d
    length_km: 60
    a: { joint: lc-upc,        to: A-amp.out }
    b: { joint: fusion-splice, to: span-AB-2.a }
  - id: span-AB-2
    type: g652d
    length_km: 20
    a: { joint: fusion-splice, to: span-AB-1.b }
    b: { joint: lc-upc,        to: B-demux.common }

layout:`));
  });

  test("replacing a block map value with a flow value keeps the key-line comment", () => {
    const files = projectFiles();
    const s = openProject("project.yaml", files);
    // an x: extension map replaced by a scalar-only map
    expect(s.apply([{ op: "setMargins", margins: {} }])).toEqual([]);
    expect(text(s, "project.yaml")).toBe(PROJECT_YAML.replace(/  margins:[^\n]*\n(    [^\n]*\n)+/, ""));
    expect(s.model.project.margins).toBeUndefined();
  });

  test("a flow-style item list gets flow items; block list under a comment keeps its comment", () => {
    const s = openProject("p.yaml", {
      "p.yaml": "lumantite: 1\nproject: {name: X}\nnodes: [{id: a, model: m}]   # inline list\nfibres:   # none yet\n",
    });
    expect(s.apply([
      { op: "addNode", file: "p.yaml", node: { id: "b", model: "m", settings: { gain_dB: 3 } } },
      { op: "addFibre", file: "p.yaml", fibre: { id: "f", type: "t", a: { to: "a.out" }, b: { to: "b.in" } } },
    ])).toEqual([]);
    expect(text(s, "p.yaml")).toBe(
      "lumantite: 1\nproject: {name: X}\nnodes: [{id: a, model: m}, {id: b, model: m, settings: {gain_dB: 3}}]   # inline list\n"
      + "fibres:   # none yet\n  - id: f\n    type: t\n    a: {to: a.out}\n    b: {to: b.in}\n");
  });

  test("indentation style of the file is respected (4 spaces, non-indented sequences)", () => {
    const src = "lumantite: 1\nproject:\n    name: X\nnodes:\n- id: a\n  model: m\n";
    const s = openProject("p.yaml", { "p.yaml": src });
    expect(s.apply([
      { op: "addNode", file: "p.yaml", node: { id: "b", model: "m" } },
      { op: "setProjectMeta", patch: { wavelength_plans: ["cwdm-18"] } },
    ])).toEqual([]);
    expect(text(s, "p.yaml")).toBe("lumantite: 1\nproject:\n    name: X\n    wavelength_plans: [ cwdm-18 ]\nnodes:\n- id: a\n  model: m\n- id: b\n  model: m\n");
  });
});
