import { describe, it, expect } from "vitest";
import { resolveCatalog, portsOf, compute, validate, toSignalsCsv, toPortsCsv, toMarkdown } from "./engine";
import { openCatalog, openProject } from "./project";
import { SAMPLE_CATALOG_FILES, SAMPLE_PROJECT_FILES, SAMPLE_ROOT } from "../sample";

const entries = () => openCatalog(SAMPLE_CATALOG_FILES).entries.map((e) => e.entry);

describe("engine adapter", () => {
  it("resolves the sample catalog incl. extends chains and plans", () => {
    const { catalog, issues } = resolveCatalog(entries());
    expect(issues).toEqual([]);
    const m = catalog.models.get("fs-sfp-10g-dwdm-c22-80km");
    expect(m?.kind).toBe("transceiver");
    if (m?.kind === "transceiver") {
      expect(m.tx.wavelength).toEqual({ plan: "dwdm-c-100ghz-40", channel: "C22" });
      expect(m.rx.sensitivity_dBm).toBe(-24); // inherited
    }
    expect(catalog.channels("dwdm-c-100ghz-40")).toHaveLength(40);
    expect(catalog.channel("dwdm-c-100ghz-40", "C21")?.wavelength_nm).toBeCloseTo(1560.61, 1);
  });

  it("reports extends cycles and invalid entries", () => {
    const { issues } = resolveCatalog([
      { kind: "host", id: "a", extends: "b" }, { kind: "host", id: "b", extends: "a" }, { kind: "joint", id: "j" },
    ]);
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("catalog.extends_cycle");
    expect(codes).toContain("catalog.invalid_model");
  });

  it("portsOf derives transceiver, mux, amp, splitter and host ports", () => {
    const { catalog } = resolveCatalog(entries());
    const p = (id: string) => portsOf(catalog.models.get(id)!, catalog);
    expect(Object.keys(p("generic-10g-lr"))).toEqual(["tx", "rx"]);
    const mux = p("generic-dwdm-40ch-100ghz");
    expect(mux.common?.direction).toBe("bidi");
    expect(mux.C21?.channel).toBe("C21");
    expect(Object.keys(mux)).toHaveLength(1 + 40 + 1); // common + channels + express
    expect(Object.keys(p("generic-oadm-4ch-c21"))).toEqual(["common", "C21", "C22", "C23", "C24"]);
    expect(Object.keys(p("acme-edfa-ba-20"))).toEqual(["in", "out"]);
    expect(Object.keys(p("splitter-90-10"))).toEqual(["in", "out1", "out2"]);
    expect(p("generic-host")).toEqual({});
  });

  it("compute gives every Tx a signal, deterministically, with issues and statuses", () => {
    const { catalog } = resolveCatalog(entries());
    const s = openProject(SAMPLE_ROOT, SAMPLE_PROJECT_FILES);
    expect(validate(s.model, catalog)).toEqual([]);
    const r1 = compute(s.model, catalog);
    const r2 = compute(s.model, catalog);
    const txCount = s.model.nodes.filter((n) => catalog.models.get(n.model)?.kind === "transceiver").length;
    expect(r1.signals).toHaveLength(txCount);
    expect(r1.signals.map((x) => x.powerAtEnd)).toEqual(r2.signals.map((x) => x.powerAtEnd));
    const a21 = r1.signals.find((x) => x.id === "A-sfp-21.tx:C21")!;
    expect(a21.terminated).toBe("rx");
    expect(a21.rx).toEqual({ node: "B-sfp-21", port: "rx" });
    expect(a21.path.map((p) => p.element)).toContain("span-AB-1");
    expect(a21.path.some((p) => p.kind === "joint")).toBe(true);
    expect(r1.amplifiers.map((a) => a.id)).toEqual(["A-amp"]);
    expect(r1.summary.signals).toBe(txCount);
    expect(r1.elementStatus["span-AB-1"]).toBeDefined();
    expect(r1.ports.find((p) => p.node === "A-mux" && p.port === "common")?.out.channels).toHaveLength(4);
  });

  it("margins change the outcome", () => {
    const { catalog } = resolveCatalog(entries());
    const s = openProject(SAMPLE_ROOT, SAMPLE_PROJECT_FILES);
    const lo = compute(s.model, catalog, { defaultMargins: {} });
    s.apply([{ op: "setMargins", margins: { system_margin_dB: 25 } }]);
    const hi = compute(s.model, catalog);
    expect(hi.summary.fail).toBeGreaterThan(lo.summary.fail);
  });

  it("exports produce CSV / markdown", () => {
    const { catalog } = resolveCatalog(entries());
    const s = openProject(SAMPLE_ROOT, SAMPLE_PROJECT_FILES);
    const r = compute(s.model, catalog);
    expect(toSignalsCsv(r).split("\n")[0]).toContain("tx,rx,channel");
    expect(toSignalsCsv(r, ";").split("\n")[0]).toContain("tx;rx;channel");
    expect(toPortsCsv(r).split("\n").length).toBeGreaterThan(5);
    expect(toMarkdown(s.model, r)).toContain("# Metro ring east");
  });
});
