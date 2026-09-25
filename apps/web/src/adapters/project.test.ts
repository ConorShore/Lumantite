import { describe, it, expect } from "vitest";
import { openProject, openCatalog, newProjectText } from "./project";
import { SAMPLE_PROJECT_FILES, SAMPLE_ROOT } from "../sample";

const open = () => openProject(SAMPLE_ROOT, SAMPLE_PROJECT_FILES);
// storage paths (files(), changedFiles()) vs model paths (model.files, element.file, layout.files)
const A = "sample/sites/exchange-a.yaml";
const B = "sample/sites/exchange-b.yaml";
const SPANS = "sample/spans.yaml";
const mA = "sites/exchange-a.yaml";
const mB = "sites/exchange-b.yaml";
const mSPANS = "spans.yaml";

describe("project adapter", () => {
  it("opens a multi-file project, flattens includes and tags each element with its file", () => {
    const s = open();
    expect(s.files()).toEqual([SAMPLE_ROOT, A, B, SPANS]);
    expect(s.model.files[1]).toEqual({ path: mA, label: "Exchange A" });
    expect(s.model.nodes.find((n) => n.id === "A-mux")?.file).toBe(mA);
    expect(s.model.fibres.find((f) => f.id === "span-AB-1")?.file).toBe(mSPANS);
    expect(s.model.layout.nodes?.["A-mux"]).toEqual({ x: 200, y: 20 });
    expect(s.model.layout.files?.[mSPANS]).toBeDefined();
    expect(s.getFileText(mSPANS)).toBe(s.getFileText(SPANS)); // either path form
    expect(s.issues).toEqual([]);
    expect(s.changedFiles()).toEqual([]);
  });

  it("reports missing includes but still opens", () => {
    const s = openProject("p.yaml", { "p.yaml": "optiplanner: 1\nincludes: [{ file: gone.yaml }]\nproject: { name: x }\n" });
    expect(s.issues.map((i) => i.code)).toContain("project.file_unknown");
    expect(s.model.project.name).toBe("x");
    expect(s.files()).toEqual(["p.yaml", "gone.yaml"]);
    expect(Object.keys(s.serialize())).toEqual(["p.yaml"]);
  });

  it("addNode writes the node and its layout into the target file only", () => {
    const s = open();
    const before = s.getFileText(A);
    s.apply([{ op: "addNode", file: mB, node: { id: "B-att", model: "att-5db" }, position: { x: 10.4, y: 20.6 } }]);
    expect(s.model.nodes.find((n) => n.id === "B-att")?.file).toBe(mB);
    const pos = s.model.layout.nodes?.["B-att"];
    expect(Math.round(pos!.x)).toBe(10); // the stub rounds; the real package may keep decimals
    expect(Math.round(pos!.y)).toBe(21);
    expect(s.changedFiles()).toEqual([B]);
    expect(s.getFileText(A)).toBe(before);
  });

  it("rejects a batch atomically when one op fails", () => {
    const s = open();
    const issues = s.apply([
      { op: "addNode", file: B, node: { id: "new1", model: "att-5db" } },
      { op: "addNode", file: B, node: { id: "A-mux", model: "att-5db" } }, // duplicate
    ]);
    expect(issues.some((i) => i.severity === "error")).toBe(true);
    expect(s.model.nodes.some((n) => n.id === "new1")).toBe(false);
    expect(s.changedFiles()).toEqual([]);
  });

  it("updateNode: undefined deletes a key, other keys are set", () => {
    const s = open();
    s.apply([{ op: "updateNode", id: "A-sfp-21", patch: { host: undefined, name: "left" } }]);
    const n = s.model.nodes.find((x) => x.id === "A-sfp-21")!;
    expect(n.host).toBeUndefined();
    expect(n.name).toBe("left");
    expect(s.getFileText(A)).not.toContain("host: A-sw1, slot: Eth1/1");
  });

  it("deleteNode detaches fibre ends that pointed at it and drops its layout", () => {
    const s = open();
    s.apply([{ op: "deleteNode", id: "A-amp" }]);
    expect(s.model.nodes.some((n) => n.id === "A-amp")).toBe(false);
    expect(s.model.layout.nodes?.["A-amp"]).toBeUndefined();
    expect(s.model.fibres.find((f) => f.id === "A-p-amp")?.b.to).toBeUndefined();
    expect(s.model.fibres.find((f) => f.id === "span-AB-1")?.a.to).toBeUndefined();
    expect(new Set(s.changedFiles())).toEqual(new Set([A, SPANS]));
  });

  it("addFibre / updateFibre merges a/b one level deep / deleteFibre clears the far end", () => {
    const s = open();
    s.apply([{ op: "addFibre", file: SPANS, fibre: { id: "f1", type: "g652d", length_km: 5, a: { to: "A-mux.express", joint: "lc-upc" }, b: {} } }]);
    expect(s.model.fibres.find((f) => f.id === "f1")?.file).toBe(mSPANS);
    s.apply([{ op: "updateFibre", id: "f1", patch: { length_km: 7, a: { to: "A-demux.express" } } }]);
    const f1 = s.model.fibres.find((f) => f.id === "f1")!;
    expect(f1.length_km).toBe(7);
    expect(f1.a).toEqual({ to: "A-demux.express", joint: "lc-upc" });
    s.apply([{ op: "deleteFibre", id: "span-AB-2" }]);
    expect(s.model.fibres.find((f) => f.id === "span-AB-1")?.b.to).toBeUndefined();
  });

  it("setLayout: nodes go to their own file, sites and files to the parent; layout-only", () => {
    const s = open();
    s.apply([
      { op: "setLayout", kind: "node", id: "B-mux", rect: { x: 1, y: 2 } },
      { op: "setLayout", kind: "file", id: SPANS, rect: { x: 0, y: 0, w: 100, h: 50 } }, // storage form accepted
    ]);
    expect(s.model.layout.nodes?.["B-mux"]).toEqual({ x: 1, y: 2 });
    expect(s.model.layout.files?.[mSPANS]).toEqual({ x: 0, y: 0, w: 100, h: 50 }); // stored under the model path
    expect(new Set(s.changedFiles())).toEqual(new Set([B, SAMPLE_ROOT]));
  });

  it("moveToFile moves the node and its layout entry between files", () => {
    const s = open();
    s.apply([{ op: "moveToFile", kind: "node", id: "A-amp", file: mSPANS }]);
    expect(s.model.nodes.find((n) => n.id === "A-amp")?.file).toBe(mSPANS);
    expect(s.getFileText(SPANS)).toContain("A-amp");
    expect(s.getFileText(A)).not.toContain("A-amp:");
    expect(s.model.layout.nodes?.["A-amp"]).toEqual({ x: 380, y: 40 });
    // cross-file references keep resolving
    expect(s.model.fibres.find((f) => f.id === "span-AB-1")?.a.to).toBe("A-amp.out");
  });

  it("setMargins writes to the parent only; empty margins remove the key", () => {
    const s = open();
    s.apply([{ op: "setMargins", margins: { system_margin_dB: 2, ageing_dB: undefined } }]);
    expect(s.model.project.margins).toEqual({ system_margin_dB: 2 });
    expect(s.changedFiles()).toEqual([SAMPLE_ROOT]);
    s.apply([{ op: "setMargins", margins: {} }]);
    expect(s.model.project.margins).toBeUndefined();
  });

  it("addFile creates an empty fragment + includes entry relative to the parent", () => {
    const s = open();
    s.apply([{ op: "addFile", file: "extra.yaml", label: "Extra" }]);
    expect(s.files()).toContain("sample/extra.yaml");
    expect(s.model.files.map((f) => f.path)).toContain("extra.yaml");
    expect(s.getFileText(SAMPLE_ROOT)).toContain("file: extra.yaml");
    expect(s.changedFiles()).toContain("sample/extra.yaml");
    const issues = s.apply([{ op: "removeFile", file: A }]);
    expect(issues.length).toBeGreaterThan(0);
    s.apply([{ op: "removeFile", file: "sample/extra.yaml" }]);
    expect(s.files()).not.toContain("sample/extra.yaml");
  });

  it("renameId rewrites references across files", () => {
    const s = open();
    s.apply([{ op: "renameId", kind: "node", from: "A-amp", to: "A-boost" }]);
    expect(s.model.fibres.find((f) => f.id === "span-AB-1")?.a.to).toBe("A-boost.out");
    expect(s.model.layout.nodes?.["A-boost"]).toBeDefined();
  });

  it("setFileText re-parses one file and keeps the user's text verbatim; parse errors are issues", () => {
    const s = open();
    const txt = s.getFileText(SPANS).replace("length_km: 60", "length_km: 61");
    s.setFileText(SPANS, txt);
    expect(s.getFileText(SPANS)).toBe(txt);
    expect(s.model.fibres.find((f) => f.id === "span-AB-1")?.length_km).toBe(61);
    const bad = s.setFileText(SPANS, "fibres: [\n");
    expect(bad.map((i) => i.code)).toContain("project.parse_error");
    expect(bad[0]?.element).toBe(SPANS); // file issues use storage paths
    // ops refuse to touch a file that does not parse
    const r = s.apply([{ op: "updateFibre", id: "span-AB-1", patch: { length_km: 1 } }]);
    expect(r.some((i) => i.severity === "error")).toBe(true);
  });

  it("markSaved clears changedFiles", () => {
    const s = open();
    s.apply([{ op: "setLayout", kind: "node", id: "B-mux", rect: { x: 1, y: 2 } }]);
    expect(s.changedFiles()).toEqual([B]);
    s.markSaved();
    expect(s.changedFiles()).toEqual([]);
  });

  it("newProjectText opens as a valid parent", () => {
    const s = openProject("n/project.yaml", { "n/project.yaml": newProjectText("New") });
    expect(s.issues).toEqual([]);
    expect(s.model.project.name).toBe("New");
  });
});

describe("catalog session", () => {
  it("reads sequences and multi-doc streams, upserts by id and appends new entries", () => {
    const c = openCatalog({ "a.yaml": "- { kind: joint, id: j1, family: LC, insertion_loss_dB: 0.3 }\n", "b.yaml": "kind: host\nid: h1\n---\nkind: host\nid: h2\n" });
    expect(c.entries.map((e) => (e.entry as { id: string }).id)).toEqual(["j1", "h1", "h2"]);
    c.upsert("x.yaml", { kind: "host", id: "h2", description: "changed" });
    expect(c.changedFiles()).toEqual(["b.yaml"]);
    c.upsert("x.yaml", { kind: "host", id: "h3" });
    expect(c.changedFiles()).toEqual(["b.yaml", "x.yaml"]);
    c.remove("j1");
    expect(c.entries.length).toBe(3);
    c.markSaved();
    expect(c.changedFiles()).toEqual([]);
  });
});
