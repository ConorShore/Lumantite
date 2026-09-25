import { describe, expect, it } from "vitest";
import type { FibreModel, TransceiverModel } from "@optiplanner/schema";
import { portsOf, resolveCatalog } from "../src/index.js";
import { catalog, near } from "./fixtures.js";

describe("resolveCatalog", () => {
  it("deep-merges extends chains (child wins)", () => {
    const c = catalog();
    const patch = c.models.get("lc-patch") as FibreModel;
    expect(patch.default_joint).toBe("lc-upc");
    expect(patch.default_length_km).toBe(0.002);
    expect(Array.isArray(patch.attenuation_dB_per_km)).toBe(true);
    expect(patch.dispersion.model).toBe("g652");
    const t5 = c.models.get("grey-1550-t5") as TransceiverModel;
    expect(t5.tx.power_dBm).toEqual({ min: 0, typ: 2, max: 4 });
    expect(t5.tx.wavelength).toEqual({ wavelength_nm: 1550 });
    expect(t5.rx.sensitivity_dBm).toBe(-24);
  });
  it("channels: frequency and wavelength always filled", () => {
    const c = catalog();
    const c21 = c.channel("dwdm-c-100ghz-40", "C21")!;
    // 299792.458 / 192.1 THz = 1560.606 nm
    near(c21.wavelength_nm, 1560.606, 1e-3);
    const cw = c.channel("cwdm-18", "1471")!;
    // 299792458 / 1471 = 203801.8 GHz
    near(cw.frequency_GHz, 203801.8, 0.1);
    expect(c.channels("dwdm-c-50ghz-80")).toHaveLength(80);
    expect(c.channels("dwdm-c-50ghz-80")[1].id).toBe("C21.5");
    expect(c.channels("nope")).toEqual([]);
  });
  it("reports and drops invalid entries, unknown parents and extends cycles", () => {
    const { catalog: c, issues } = resolveCatalog([
      { kind: "joint", id: "ok", family: "LC", insertion_loss_dB: 0.2 },
      { kind: "joint", id: "bad", family: "LC" }, // missing insertion_loss_dB
      { kind: "joint", id: "orphan", extends: "missing", family: "LC", insertion_loss_dB: 0.1 },
      { kind: "joint", id: "c1", extends: "c2", family: "LC", insertion_loss_dB: 0.1 },
      { kind: "joint", id: "c2", extends: "c1", family: "LC", insertion_loss_dB: 0.1 },
      { nope: true },
    ]);
    expect([...c.models.keys()]).toEqual(["ok"]);
    const codes = issues.map((i) => `${i.code}:${i.element}`).sort();
    expect(codes).toContain("catalog.invalid_model:bad");
    expect(codes).toContain("catalog.unknown_model:orphan");
    expect(codes).toContain("catalog.extends_cycle:c1");
    expect(codes).toContain("catalog.extends_cycle:c2");
    expect(codes.some((x) => x.startsWith("catalog.invalid_model:#5"))).toBe(true);
  });
  it("later entries with the same id override earlier ones (project-local catalog)", () => {
    const { catalog: c } = resolveCatalog([
      { kind: "joint", id: "j", family: "LC", insertion_loss_dB: 0.2 },
      { kind: "joint", id: "j", family: "LC", insertion_loss_dB: 0.3 },
    ]);
    expect((c.models.get("j") as { insertion_loss_dB: number }).insertion_loss_dB).toBe(0.3);
  });
  it("unknown mux plan → catalog.unknown_plan", () => {
    const { issues } = resolveCatalog([{ kind: "mux", id: "m", plan: "nope", channel_ports: "all", insertion_loss_dB: 3 }]);
    expect(issues.map((i) => i.code)).toContain("catalog.unknown_plan");
  });
});

describe("portsOf", () => {
  const c = catalog();
  it("transceiver default ports {tx: out, rx: in} with the model connector", () => {
    expect(portsOf(c.models.get("grey-1550")!, c)).toEqual({
      tx: { direction: "out", connector: "lc-upc" },
      rx: { direction: "in", connector: "lc-upc" },
    });
  });
  it("BiDi transceiver: one bidi port", () => {
    expect(portsOf(c.models.get("bidi-1310")!, c)).toEqual({ bidi: { direction: "bidi", connector: "lc-upc" } });
  });
  it("mux: common + generated channel ports (+ express)", () => {
    const p = portsOf(c.models.get("mux40")!, c);
    expect(Object.keys(p)).toHaveLength(41);
    expect(p.common).toEqual({ direction: "bidi", connector: "lc-upc" });
    expect(p.C21).toEqual({ direction: "bidi", channel: "C21", connector: "lc-upc" });
    const o = portsOf(c.models.get("oadm4-x")!, c);
    expect(Object.keys(o).sort()).toEqual(["C21", "C22", "C23", "C24", "common", "express"]);
  });
  it("amplifier in/out, splitter outN, passives bidi, host none", () => {
    expect(portsOf(c.models.get("edfa")!, c)).toEqual({ in: { direction: "in", connector: "lc-upc" }, out: { direction: "out", connector: "lc-upc" } });
    expect(Object.keys(portsOf(c.models.get("split-50")!, c))).toEqual(["in", "out1", "out2"]);
    expect(portsOf(c.models.get("att5")!, c).in.direction).toBe("bidi");
    expect(portsOf(c.models.get("host")!, c)).toEqual({});
  });
});
