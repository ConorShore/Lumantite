import { describe, expect, test } from "vitest";
import { openCatalog } from "../src/index.js";

const JOINTS = `# Joints — connectors and splices
- kind: joint
  id: lc-upc          # LC/UPC mated pair
  family: lc-upc
  insertion_loss_dB: { min: 0.1, typ: 0.25, max: 0.5 }
  source: "TIA-568 (max)"

# fusion splices
- kind: joint
  id: fusion-splice
  insertion_loss_dB: { typ: 0.05, max: 0.1 }
`;

const FIBRES = `# Fibre types
kind: fibre
id: g652d
attenuation_dB_per_km:
  - { nm: 1310, value: 0.33 }
  - { nm: 1550, value: 0.20 }
dispersion: { model: g652, zero_dispersion_nm: 1310, zero_dispersion_slope_ps_nm2_km: 0.092 }
---
# bend-insensitive
kind: fibre
id: g657a1
extends: g652d
---
kind: fibre
id: lc-patch
extends: g652d
default_length_km: 0.002
`;

const open = () => openCatalog({ "joints.yaml": JOINTS, "fibres.yaml": FIBRES });

describe("catalog sessions", () => {
  test("sequence and multi-document forms load and round-trip untouched", () => {
    const c = open();
    expect(c.issues).toEqual([]);
    expect(c.entries.map((e) => `${e.file}#${e.index}:${(e.entry as { id: string }).id}`)).toEqual([
      "joints.yaml#0:lc-upc", "joints.yaml#1:fusion-splice",
      "fibres.yaml#0:g652d", "fibres.yaml#1:g657a1", "fibres.yaml#2:lc-patch",
    ]);
    expect((c.entries[2].entry as Record<string, unknown>).attenuation_dB_per_km).toEqual([{ nm: 1310, value: 0.33 }, { nm: 1550, value: 0.2 }]);
    expect(c.serialize()).toEqual({ "joints.yaml": JOINTS, "fibres.yaml": FIBRES });
    expect(c.changedFiles()).toEqual([]);
  });

  test("upsert replaces in place (sequence form), keeping comments of untouched keys", () => {
    const c = open();
    c.upsert("other.yaml", {
      kind: "joint", id: "lc-upc", family: "lc-upc",
      insertion_loss_dB: { min: 0.1, typ: 0.2, max: 0.5 }, source: "TIA-568 (max)",
    });
    expect(c.getFileText("joints.yaml")).toBe(JOINTS.replace("typ: 0.25", "typ: 0.2"));
    expect(c.changedFiles()).toEqual(["joints.yaml"]);
    expect(c.getFileText("other.yaml")).toBe("");
  });

  test("upsert replaces in place (multi-doc form); removed keys disappear", () => {
    const c = open();
    c.upsert("fibres.yaml", { kind: "fibre", id: "lc-patch", extends: "g652d" });
    expect(c.getFileText("fibres.yaml")).toBe(FIBRES.replace("default_length_km: 0.002\n", ""));
  });

  test("upsert appends to a sequence file", () => {
    const c = open();
    c.upsert("joints.yaml", { kind: "joint", id: "sc-apc", family: "sc-apc", insertion_loss_dB: { typ: 0.3 } });
    expect(c.getFileText("joints.yaml")).toBe(JOINTS + "- kind: joint\n  id: sc-apc\n  family: sc-apc\n  insertion_loss_dB: { typ: 0.3 }\n");
    expect(c.entries.map((e) => (e.entry as { id: string }).id)).toContain("sc-apc");
    expect(c.entries.find((e) => (e.entry as { id: string }).id === "sc-apc")?.index).toBe(2);
  });

  test("upsert appends a document to a multi-doc file", () => {
    const c = open();
    c.upsert("fibres.yaml", { id: "g655", kind: "fibre", attenuation_dB_per_km: 0.22, dispersion: { model: "none" } });
    expect(c.getFileText("fibres.yaml")).toBe(FIBRES + "---\nkind: fibre\nid: g655\nattenuation_dB_per_km: 0.22\ndispersion: { model: none }\n");
  });

  test("upsert into a new file creates it", () => {
    const c = open();
    c.upsert("amps.yaml", { kind: "amplifier", id: "edfa-1", gain_dB: { min: 10, max: 25 } });
    expect(c.getFileText("amps.yaml")).toBe("kind: amplifier\nid: edfa-1\ngain_dB: { min: 10, max: 25 }\n");
    expect(c.changedFiles()).toEqual(["amps.yaml"]);
    c.upsert("amps.yaml", { kind: "amplifier", id: "edfa-2" });
    expect(c.getFileText("amps.yaml")).toBe("kind: amplifier\nid: edfa-1\ngain_dB: { min: 10, max: 25 }\n---\nkind: amplifier\nid: edfa-2\n");
    expect(c.entries.filter((e) => e.file === "amps.yaml")).toHaveLength(2);
  });

  test("remove from both forms", () => {
    const c = open();
    c.remove("lc-upc");
    c.remove("g657a1");
    expect(c.getFileText("joints.yaml")).toBe(`# Joints — connectors and splices

# fusion splices
- kind: joint
  id: fusion-splice
  insertion_loss_dB: { typ: 0.05, max: 0.1 }
`);
    expect(c.getFileText("fibres.yaml")).toBe(FIBRES.replace("---\n# bend-insensitive\nkind: fibre\nid: g657a1\nextends: g652d\n", ""));
    expect(c.entries.map((e) => (e.entry as { id: string }).id)).toEqual(["fusion-splice", "g652d", "lc-patch"]);
    c.remove("nothing-here");
    expect(c.changedFiles()).toEqual(["joints.yaml", "fibres.yaml"]);
    c.markSaved(["joints.yaml"]);
    expect(c.changedFiles()).toEqual(["fibres.yaml"]);
  });

  test("remove the first document of a multi-doc file", () => {
    const c = open();
    c.remove("g652d");
    const t = c.getFileText("fibres.yaml");
    expect(t.startsWith("# Fibre types\n---\n# bend-insensitive\n")).toBe(true);
    expect(c.entries.filter((e) => e.file === "fibres.yaml").map((e) => (e.entry as { id: string }).id)).toEqual(["g657a1", "lc-patch"]);
  });

  test("parse errors and invalid entries are issues", () => {
    const c = openCatalog({ "bad.yaml": "- kind: joint\n  id: [\n", "odd.yaml": "- kind: joint\n- 42\n" });
    expect(c.issues.some((i) => i.code === "project.parse_error" && i.element === "bad.yaml")).toBe(true);
    expect(c.issues.filter((i) => i.code === "catalog.invalid_model")).toHaveLength(2);
    expect(c.entries).toEqual([]);
    const fixed = c.setFileText("bad.yaml", "- kind: joint\n  id: ok\n");
    expect(fixed).toEqual([]);
    expect(c.entries.map((e) => e.file)).toEqual(["bad.yaml"]);
  });
});
