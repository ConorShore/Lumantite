/**
 * Coverage for existing engine behaviour that SPEC §12's T1–T44 don't exercise directly.
 * Each case builds on the shared test catalog (fixtures.ts) plus a few local entries added
 * via `resolveCatalog([...CATALOG_ENTRIES, ...local])` (see the file header note in
 * fixtures.ts). Arithmetic is shown in comments, same convention as the other test files.
 */
import { describe, expect, it } from "vitest";
import { compute, resolveCatalog } from "../src/index.js";
import { CATALOG_ENTRIES, catalog, check, fibre, ideal, issues, near, project, sig } from "./fixtures.js";

function localCatalog(extra: unknown[]) {
  const r = resolveCatalog([...CATALOG_ENTRIES, ...extra]);
  if (r.issues.length) throw new Error("local test catalog invalid: " + JSON.stringify(r.issues));
  return r.catalog;
}

describe("amp.input_high", () => {
  it("Pin_total above input_power_total_dBm.max → fail", () => {
    // edfa: input_power_total_dBm { min: -30, max: 5 }
    const m = project(
      [
        { id: "tx", model: "grey-1550", settings: { tx_power_override_dBm: 10 } },
        { id: "amp", model: "edfa", settings: { mode: "constant_gain", gain_dB: 10 } },
        { id: "rx", model: "grey-1550" },
      ],
      [ideal("p1", "tx.tx", "amp.in"), ideal("p2", "amp.out", "rx.rx")],
    );
    const r = compute(m, catalog());
    const i = issues(r, "amp.input_high", "amp");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("error");
    // margin = 5 − 10 = −5
    near(Number(i[0].values!.margin), -5);
    near(Number(i[0].values!.pin_total_max), 10);
  });
});

describe("catalog.unknown_joint (fibre-to-fibre junction, no joint on either end)", () => {
  const bareFibre = { kind: "fibre", id: "bare-fibre", attenuation_dB_per_km: 0.3, dispersion: { model: "none" } };
  it("warns and is treated as lossless", () => {
    const cat = localCatalog([bareFibre]);
    const m = project(
      [
        { id: "tx", model: "grey-1550" },
        { id: "rx", model: "grey-1550" },
      ],
      [
        // no default_joint on bare-fibre and no explicit joint at the junction
        fibre("s1", "bare-fibre", "tx.tx", "s2.a", { length_km: 5, ja: "lc-upc" }),
        fibre("s2", "bare-fibre", "s1.b", "rx.rx", { length_km: 5, jb: "lc-upc" }),
      ],
    );
    const r = compute(m, cat);
    const i = issues(r, "catalog.unknown_joint");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("warn");
    // loss = 10 km × 0.3 dB/km + 2 × LC (0.25) + 0 (the junction itself) = 3.5
    near(sig(r, "tx.tx:1550nm").powerAtEnd.typ, -3.5);
  });
});

describe("amp.gain_out_of_range fail path (not prevented by clamping)", () => {
  it("constant_gain setting above the model's gain_dB.max, far from saturation → fail", () => {
    // edfa: gain_dB { min: 10, max: 23 }, output_power_total_dBm.max 20
    // Pin_total −30 (min case), G 30 → Pout −30+30=0 ≤ 20: no saturation clamp, so G stays 30 > 23.
    const m = project(
      [
        { id: "tx", model: "grey-1550", settings: { tx_power_override_dBm: -30 } },
        { id: "amp", model: "edfa", settings: { mode: "constant_gain", gain_dB: 30 } },
        { id: "rx", model: "grey-1550" },
      ],
      [ideal("p1", "tx.tx", "amp.in"), ideal("p2", "amp.out", "rx.rx")],
    );
    const r = compute(m, catalog());
    const i = issues(r, "amp.gain_out_of_range", "amp");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("error");
    near(Number(i[0].values!.gain_typ), 30);
    near(Number(i[0].values!.range_max), 23);
    expect(issues(r, "amp.output_saturated", "amp")).toHaveLength(0);
  });
});

describe("rx.cd with asymmetric {min, max} tolerance", () => {
  const asymRx = {
    kind: "transceiver",
    id: "grey-1550-asym-cd",
    extends: "grey-1550",
    rx: { sensitivity_dBm: -24, overload_dBm: 0, cd_tolerance_ps_nm: { min: -500, max: 1600 }, wavelength_range_nm: [1260, 1620] },
  };
  const cat = localCatalog([asymRx]);
  it("positive CD near the max side: pass just under, fail just over", () => {
    // D(1550) = 17.4605 ps/(nm.km); 91 km → 1588.9 (pass, < 1600); 92 km → 1606.4 (fail, > 1600)
    const under = compute(
      project([{ id: "tx", model: "grey-1550" }, { id: "rx", model: "grey-1550-asym-cd" }], [fibre("f1", "g652d", "tx.tx", "rx.rx", { length_km: 91, ja: "lc-upc", jb: "lc-upc" })], {
        cd_margin_pct: 0,
      }),
      cat,
    );
    const cUnder = check(sig(under, "tx.tx:1550nm"), "rx.cd");
    near(cUnder.values!.cd_ps_nm as number, 1588.9, 1);
    expect(cUnder.status).toBe("pass");

    const over = compute(
      project([{ id: "tx", model: "grey-1550" }, { id: "rx", model: "grey-1550-asym-cd" }], [fibre("f1", "g652d", "tx.tx", "rx.rx", { length_km: 92, ja: "lc-upc", jb: "lc-upc" })], {
        cd_margin_pct: 0,
      }),
      cat,
    );
    const cOver = check(sig(over, "tx.tx:1550nm"), "rx.cd");
    expect(cOver.status).toBe("fail");
  });
  it("negative CD near the min side (−500): DCM overcompensation", () => {
    // 30 km G.652.D → 17.4605 × 30 = 523.8 ps/nm; DCM −800 → −276.2 ps/nm: within −500…1600 → pass
    const m1 = project(
      [
        { id: "tx", model: "grey-1550" },
        { id: "dcm", model: "dcm-800" },
        { id: "rx", model: "grey-1550-asym-cd" },
      ],
      [fibre("f1", "g652d", "tx.tx", "dcm.in", { length_km: 30, ja: "lc-upc", jb: "lc-upc" }), fibre("p1", "lc-patch", "dcm.out", "rx.rx", { length_km: 0 })],
      { cd_margin_pct: 0 },
    );
    const r1 = compute(m1, cat);
    const c1 = check(sig(r1, "tx.tx:1550nm"), "rx.cd");
    near(c1.values!.cd_ps_nm as number, -276.2, 0.5);
    expect(c1.status).toBe("pass");

    // 5 km G.652.D → 87.3 ps/nm; DCM −800 → −712.7 ps/nm: below −500 → fail
    const m2 = project(
      [
        { id: "tx", model: "grey-1550" },
        { id: "dcm", model: "dcm-800" },
        { id: "rx", model: "grey-1550-asym-cd" },
      ],
      [fibre("f1", "g652d", "tx.tx", "dcm.in", { length_km: 5, ja: "lc-upc", jb: "lc-upc" }), fibre("p1", "lc-patch", "dcm.out", "rx.rx", { length_km: 0 })],
      { cd_margin_pct: 0 },
    );
    const r2 = compute(m2, cat);
    const c2 = check(sig(r2, "tx.tx:1550nm"), "rx.cd");
    expect(c2.status).toBe("fail");
  });
});

describe("VOA / attenuator", () => {
  const voa = { kind: "attenuator", id: "voa-test", range_dB: { min: 0, max: 20 }, connector: "lc-upc" };
  const cat = localCatalog([voa]);
  it("fixed attenuator (att5, 5 dB)", () => {
    const m = project(
      [
        { id: "tx", model: "grey-1550" },
        { id: "att", model: "att5" },
        { id: "rx", model: "grey-1550" },
      ],
      [ideal("p1", "tx.tx", "att.in"), ideal("p2", "att.out", "rx.rx")],
    );
    const r = compute(m, catalog());
    // 0 − 5 = −5 dBm
    near(sig(r, "tx.tx:1550nm").powerAtEnd.typ, -5);
  });
  it("VOA setting_dB within range", () => {
    const m = project(
      [
        { id: "tx", model: "grey-1550" },
        { id: "voa", model: "voa-test", settings: { setting_dB: 7 } },
        { id: "rx", model: "grey-1550" },
      ],
      [ideal("p1", "tx.tx", "voa.in"), ideal("p2", "voa.out", "rx.rx")],
    );
    const r = compute(m, cat);
    near(sig(r, "tx.tx:1550nm").powerAtEnd.typ, -7);
    expect(issues(r, "project.invalid_settings", "voa")).toHaveLength(0);
  });
  it("VOA setting_dB outside range_dB → project.invalid_settings", () => {
    const m = project(
      [
        { id: "tx", model: "grey-1550" },
        { id: "voa", model: "voa-test", settings: { setting_dB: 25 } },
        { id: "rx", model: "grey-1550" },
      ],
      [ideal("p1", "tx.tx", "voa.in"), ideal("p2", "voa.out", "rx.rx")],
    );
    const r = compute(m, cat);
    const i = issues(r, "project.invalid_settings", "voa");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("error");
  });
});

describe("splitter ratio and excess loss numbers", () => {
  // 90/10 with 0.3 dB excess: leg1 = 10*log10(100/90) + 0.3 = 0.4576 + 0.3 = 0.7576
  //                            leg2 = 10*log10(100/10) + 0.3 = 10.0000 + 0.3 = 10.3
  const split9010 = { kind: "splitter", id: "split-90-10", ratio: [90, 10], excess_loss_dB: 0.3, connector: "lc-upc" };
  const cat = localCatalog([split9010]);
  const m = project(
    [
      { id: "tx", model: "grey-1550" },
      { id: "sp", model: "split-90-10" },
      { id: "r1", model: "grey-1550" },
      { id: "r2", model: "grey-1550" },
    ],
    [ideal("p0", "tx.tx", "sp.in"), ideal("p1", "sp.out1", "r1.rx"), ideal("p2", "sp.out2", "r2.rx")],
  );
  const r = compute(m, cat);
  const atRx = (node: string) => r.signals.find((s) => s.rx?.node === node)!;
  it("90% leg: 0.458 + 0.3 excess = 0.758 dB", () => {
    near(-atRx("r1").powerAtEnd.typ, 0.7576, 1e-3);
  });
  it("10% leg: 10.0 + 0.3 excess = 10.3 dB", () => {
    near(-atRx("r2").powerAtEnd.typ, 10.3, 1e-3);
  });
});

describe("passthrough loss", () => {
  it("scalar insertion loss", () => {
    const pt = { kind: "passthrough", id: "pt-scalar", insertion_loss_dB: 0.5, connector: "lc-upc" };
    const cat = localCatalog([pt]);
    const m = project(
      [
        { id: "tx", model: "grey-1550" },
        { id: "pt", model: "pt-scalar" },
        { id: "rx", model: "grey-1550" },
      ],
      [ideal("p1", "tx.tx", "pt.in"), ideal("p2", "pt.out", "rx.rx")],
    );
    const r = compute(m, cat);
    near(sig(r, "tx.tx:1550nm").powerAtEnd.typ, -0.5);
  });
  it("wavelength-table insertion loss (interpolated)", () => {
    const pt = {
      kind: "passthrough",
      id: "pt-table",
      insertion_loss_dB: [
        { nm: 1500, value: 0.3 },
        { nm: 1600, value: 0.7 },
      ],
      connector: "lc-upc",
    };
    const cat = localCatalog([pt]);
    const m = project(
      [
        { id: "tx", model: "grey-1550" },
        { id: "pt", model: "pt-table" },
        { id: "rx", model: "grey-1550" },
      ],
      [ideal("p1", "tx.tx", "pt.in"), ideal("p2", "pt.out", "rx.rx")],
    );
    const r = compute(m, cat);
    // 1550 is the midpoint of 1500..1600: (0.3 + 0.7)/2 = 0.5
    near(sig(r, "tx.tx:1550nm").powerAtEnd.typ, -0.5);
  });
});

describe("DCM table dispersion", () => {
  it("wavelength-table dispersion (interpolated)", () => {
    const dcmTable = {
      kind: "dcm",
      id: "dcm-table",
      dispersion_ps_nm: [
        { nm: 1500, value: -500 },
        { nm: 1600, value: -900 },
      ],
      insertion_loss_dB: 3.0,
      connector: "lc-upc",
    };
    const cat = localCatalog([dcmTable]);
    const m = project(
      [
        { id: "tx", model: "grey-1550" },
        { id: "dcm", model: "dcm-table" },
        { id: "rx", model: "grey-1550" },
      ],
      [ideal("p1", "tx.tx", "dcm.in"), ideal("p2", "dcm.out", "rx.rx")],
    );
    const r = compute(m, cat);
    // 1550 is the midpoint of 1500..1600: (−500 + −900)/2 = −700
    near(sig(r, "tx.tx:1550nm").cdAtEnd, -700, 0.1);
    near(sig(r, "tx.tx:1550nm").powerAtEnd.typ, -3.0);
  });
});

describe("mux port_overrides", () => {
  const muxOv = {
    kind: "mux",
    id: "mux40-ov",
    extends: "mux40",
    port_overrides: { C21: { insertion_loss_dB: 5.0 } },
  };
  const cat = localCatalog([muxOv]);
  const m = project(
    [
      { id: "t21", model: "dwdm-tunable", settings: { channel: "C21", tx_power_override_dBm: 0 } },
      { id: "t22", model: "dwdm-tunable", settings: { channel: "C22", tx_power_override_dBm: 0 } },
      { id: "mux", model: "mux40-ov" },
    ],
    [ideal("p21", "t21.tx", "mux.C21"), ideal("p22", "t22.tx", "mux.C22")],
  );
  const r = compute(m, cat);
  const common = r.ports.find((p) => p.node === "mux" && p.port === "common")!;
  it("overridden channel port (C21, 5.0 dB) vs default (C22, 3.0 dB)", () => {
    const c21 = common.out.channels.find((c) => c.channel.id === "C21")!;
    const c22 = common.out.channels.find((c) => c.channel.id === "C22")!;
    near(c21.power.typ, -5.0);
    near(c22.power.typ, -3.0);
  });
});

describe("tx_power_override_dBm", () => {
  it("overrides the model's nominal power", () => {
    const m = project([{ id: "tx", model: "grey-1550", settings: { tx_power_override_dBm: -5 } }, { id: "rx", model: "grey-1550" }], [ideal("p1", "tx.tx", "rx.rx")]);
    const r = compute(m, catalog());
    near(sig(r, "tx.tx:1550nm").powerAtEnd.typ, -5);
  });
});

describe("fibre instance overrides", () => {
  it("attenuation_dB_per_km, dispersion_ps_nm_km and extra_loss_dB all apply", () => {
    // 10 km × 0.5 dB/km + 1.0 extra = 6.0 dB loss; CD = 10 ps/nm/km × 10 km = 100 ps/nm
    const m = project(
      [
        { id: "tx", model: "grey-1550" },
        { id: "rx", model: "grey-1550" },
      ],
      [
        fibre("f1", "g652d", "tx.tx", "rx.rx", {
          length_km: 10,
          ja: "lc-ideal",
          jb: "lc-ideal",
          attenuation_dB_per_km: 0.5,
          dispersion_ps_nm_km: 10,
          extra_loss_dB: 1.0,
        }),
      ],
    );
    const r = compute(m, catalog());
    const s = sig(r, "tx.tx:1550nm");
    near(s.powerAtEnd.typ, -6.0);
    near(s.cdAtEnd, 100, 0.1);
  });
});
