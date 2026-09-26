/** SPEC §12 "Design rules": T28, T31–T34 (DCM), T38 (laser class), T41, T42 — rules in src/rules/{static,aggregate}.ts. */
import { describe, expect, it } from "vitest";
import type { Results } from "@lumantite/schema";
import { compute, resolveCatalog, type Catalog } from "../src/index.js";
import { normStandard } from "../src/rules/static.js";
import { CATALOG_ENTRIES, fibre, ideal, issues, near, project } from "./fixtures.js";

const LOCAL: unknown[] = [
  { kind: "joint", id: "lc-apc", family: "LC", polish: "APC", insertion_loss_dB: { min: 0.1, typ: 0.25, max: 0.5 } },
  { kind: "transceiver", id: "grey-1550-apc", extends: "grey-1550", connector: "lc-apc" },
  { kind: "transceiver", id: "sr-850", extends: "grey-1550", tx: { wavelength: { wavelength_nm: 850 } }, rx: { wavelength_range_nm: [840, 860] } },
  { kind: "transceiver", id: "cwdm-1391", extends: "cwdm-1471", tx: { wavelength: { plan: "cwdm-18", channel: "1391" } } },
  { kind: "transceiver", id: "dwdm-coh", extends: "dwdm-tunable", detection: "coherent" },
  { kind: "fibre", id: "g652d-std", extends: "g652d", standard: "G.652.D" },
  { kind: "fibre", id: "g652b", extends: "g652d", standard: "G.652.B" },
  { kind: "fibre", id: "g652-wet", extends: "g652d", low_water_peak: false },
  { kind: "fibre", id: "g655", attenuation_dB_per_km: 0.2, dispersion: { model: "linear", d0_ps_nm_km: 4, at_nm: 1550, slope_ps_nm2_km: 0.05 }, standard: "G.655", default_joint: "fusion-splice" },
  // dispersion-shifted: D = 0.07 × (λ − 1550)
  { kind: "fibre", id: "g653", attenuation_dB_per_km: 0.2, dispersion: { model: "linear", d0_ps_nm_km: 0, at_nm: 1550, slope_ps_nm2_km: 0.07 }, standard: "G.653", default_joint: "fusion-splice" },
  { kind: "fibre", id: "om1", multimode: true, core_um: 62.5, attenuation_dB_per_km: 3.0, dispersion: { model: "none" }, default_joint: "fusion-splice" },
  { kind: "fibre", id: "om3", multimode: true, core_um: 50, attenuation_dB_per_km: 3.0, dispersion: { model: "none" }, default_joint: "fusion-splice" },
  { kind: "fibre", id: "om3-patch", extends: "om3", default_length_km: 0.002, default_joint: "lc-upc" },
  { kind: "dcm", id: "dcm-g655", extends: "dcm-800", for_fibre: "G.655" },
  { kind: "dcm", id: "dcm-g652d", extends: "dcm-800", for_fibre: "G.652.D" },
  { kind: "dcm", id: "dcm-id", extends: "dcm-800", for_fibre: "g652d-std" },
  { kind: "mux", id: "demux-iso", extends: "mux40-s", isolation_dB: 25 },
];

let cat: Catalog | undefined;
function catalog(): Catalog {
  if (!cat) {
    const r = resolveCatalog([...CATALOG_ENTRIES, ...LOCAL]);
    if (r.issues.length) throw new Error("test catalog invalid: " + JSON.stringify(r.issues));
    cat = r.catalog;
  }
  return cat;
}

/** Tx → one fibre → Rx. */
function p2p(tx: string, type: string, km: number | undefined, opts: { pwr?: number; rx?: string; ja?: string; jb?: string } = {}): Results {
  return compute(
    project(
      [
        { id: "tx", model: tx, ...(opts.pwr !== undefined ? { settings: { tx_power_override_dBm: opts.pwr } } : {}) },
        { id: "rx", model: opts.rx ?? tx },
      ],
      [fibre("f1", type, "tx.tx", "rx.rx", { ...(km !== undefined ? { length_km: km } : {}), ja: opts.ja ?? "lc-upc", jb: opts.jb ?? "lc-upc" })],
    ),
    catalog(),
  );
}

describe("T28 per-channel launch power (R3)", () => {
  it("+6 dBm into 20 km → warn, margin 4 − 6 = −2", () => {
    const i = issues(p2p("grey-1550", "g652d", 20, { pwr: 6 }), "fibre.channel_power_high", "f1");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("warn");
    expect(i[0].port).toBe("a");
    near(Number(i[0].values!.margin), -2);
  });
  it("+6 dBm into a 2 m patch → silent (< 1 km)", () => {
    expect(issues(p2p("grey-1550", "lc-patch", undefined, { pwr: 6 }), "fibre.channel_power_high")).toHaveLength(0);
  });
  it("+4 dBm → pass (warn-only: margin 0 is silent)", () => {
    expect(issues(p2p("grey-1550", "g652d", 20, { pwr: 4 }), "fibre.channel_power_high")).toHaveLength(0);
  });
});

describe("T31 connector polish (R6)", () => {
  it("LC/APC fibre end into an LC/UPC port → error", () => {
    const i = issues(p2p("grey-1550", "g652d", 10, { ja: "lc-apc" }), "joint.polish_mismatch", "f1");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("error");
    expect(i[0].port).toBe("a");
  });
  it("UPC ↔ UPC and APC ↔ APC → silent; joints without polish → silent", () => {
    expect(issues(p2p("grey-1550", "g652d", 10), "joint.polish_mismatch")).toHaveLength(0);
    expect(issues(p2p("grey-1550-apc", "g652d", 10, { ja: "lc-apc", jb: "lc-apc" }), "joint.polish_mismatch")).toHaveLength(0);
    expect(issues(p2p("grey-1550", "g652d", 10, { ja: "lc-ideal", jb: "lc-s" }), "joint.polish_mismatch")).toHaveLength(0);
  });
  it("20 dBm total through LC/UPC → joint.reflection_risk warn at each connector end", () => {
    const i = issues(p2p("grey-1550", "g652d", 10, { pwr: 20 }), "joint.reflection_risk", "f1");
    expect(i.map((x) => x.port).sort()).toEqual(["a", "b"]);
    expect(i.every((x) => x.severity === "warn")).toBe(true);
  });
  it("+17 dBm (not more than 17) → silent", () => {
    expect(issues(p2p("grey-1550", "g652d", 10, { pwr: 17 }), "joint.reflection_risk")).toHaveLength(0);
  });
  it("20 dBm through LC/APC (APC ports) and a fusion splice → silent", () => {
    const r = compute(
      project(
        [
          { id: "tx", model: "grey-1550-apc", settings: { tx_power_override_dBm: 20 } },
          { id: "rx", model: "grey-1550-apc" },
        ],
        [fibre("f1", "g652d", "tx.tx", "f2.a", { length_km: 10, ja: "lc-apc" }), fibre("f2", "g652d", "f1.b", "rx.rx", { length_km: 10, jb: "lc-apc" })],
      ),
      catalog(),
    );
    expect(issues(r, "joint.reflection_risk")).toHaveLength(0);
    expect(issues(r, "joint.polish_mismatch")).toHaveLength(0);
  });
});

describe("T32 fibre mode and type (R7)", () => {
  const junction = (t1: string, t2: string) =>
    compute(
      project(
        [
          { id: "tx", model: "grey-1550" },
          { id: "rx", model: "grey-1550" },
        ],
        [fibre("f1", t1, "tx.tx", "f2.a", { length_km: 1, ja: "lc-upc" }), fibre("f2", t2, "f1.b", "rx.rx", { length_km: 1, jb: "lc-upc" })],
      ),
      catalog(),
    );
  it("850 nm mmf optic on G.652.D → fibre.mode_mismatch error, once per fibre (Tx and Rx both mmf)", () => {
    const i = issues(p2p("sr-850", "g652d", 1), "fibre.mode_mismatch", "f1");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("error");
    expect(i[0].values!.fibre_mode).toBe("mmf");
  });
  it("850 nm on OM3 → silent; 1550 nm smf optic on OM3 → error", () => {
    expect(issues(p2p("sr-850", "om3", 0.3), "fibre.mode_mismatch")).toHaveLength(0);
    expect(issues(p2p("grey-1550", "om3", 0.3), "fibre.mode_mismatch", "f1")).toHaveLength(1);
  });
  it("mmf Tx into an smf Rx over OM3 → error from the Rx side", () => {
    const i = issues(p2p("sr-850", "om3", 0.3, { rx: "grey-1550" }), "fibre.mode_mismatch", "f1");
    expect(i).toHaveLength(1);
    expect(i[0].values!.transceiver).toBe("rx");
  });
  it("OM1 (62.5) ↔ OM3 (50) junction → fibre.core_mismatch warn", () => {
    const r = junction("om1", "om3");
    const i = issues(r, "fibre.core_mismatch", "f1");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("warn");
    expect(i[0].port).toBe("b");
    expect(issues(junction("om3", "om3"), "fibre.core_mismatch")).toHaveLength(0);
  });
  it("G.652.D ↔ G.655 splice → fibre.type_mismatch info", () => {
    const i = issues(junction("g652d-std", "g655"), "fibre.type_mismatch", "f1");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("info");
    // silent without `standard` on one side, or with equal standards
    expect(issues(junction("g652d", "g655"), "fibre.type_mismatch")).toHaveLength(0);
    expect(issues(junction("g652d-std", "g652d-std"), "fibre.type_mismatch")).toHaveLength(0);
  });
  it("single-mode ↔ multimode junction → fibre.mode_mismatch error", () => {
    const i = issues(junction("g652d", "om3"), "fibre.mode_mismatch");
    expect(i.some((x) => x.element === "f1" && x.port === "b" && x.severity === "error")).toBe(true);
  });
});

/** Two tunable Tx → mux → span → demux (unterminated channel ports). */
function wdmSpan(type: string, km: number, chans: string[]) {
  const nodes = chans.map((ch) => ({ id: `t${ch}`, model: "dwdm-tunable", settings: { channel: ch } }));
  const fibres = chans.map((ch) => ideal(`p${ch}`, `t${ch}.tx`, `mux.${ch}`));
  return compute(
    project(
      [...nodes, { id: "mux", model: "mux40-s" }, { id: "dmx", model: "mux40-s" }],
      [...fibres, fibre("span", type, "mux.common", "dmx.common", { length_km: km, ja: "lc-upc", jb: "lc-upc" })],
    ),
    catalog(),
  );
}

describe("T33 fibre suitability (R8)", () => {
  it("two DWDM channels over 50 km of G.653 → fibre.fwm_risk", () => {
    // C34 = 193.4 THz = 1550.12 nm → D = 0.07 × 0.12 = 0.008; C35 = 193.5 THz = 1549.32 nm → D = −0.048 ps/(nm·km)
    // smallest |D| (C34) reported; both < 1
    const i = issues(wdmSpan("g653", 50, ["C34", "C35"]), "fibre.fwm_risk", "span");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("warn");
    expect(i[0].channel).toBe("C34");
    near(Number(i[0].values!.dispersion_ps_nm_km), 0.008, 0.001);
  });
  it("one channel on G.653, or two channels on G.652.D (D ≈ 17) → silent", () => {
    expect(issues(wdmSpan("g653", 50, ["C35"]), "fibre.fwm_risk")).toHaveLength(0);
    expect(issues(wdmSpan("g652d", 50, ["C34", "C35"]), "fibre.fwm_risk")).toHaveLength(0);
  });
  it("CWDM 1391 nm on low_water_peak: false → fibre.water_peak; on G.652.B (derived) → warn", () => {
    const i = issues(p2p("cwdm-1391", "g652-wet", 10), "fibre.water_peak", "f1");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("warn");
    expect(issues(p2p("cwdm-1391", "g652b", 10), "fibre.water_peak", "f1")).toHaveLength(1);
  });
  it("1391 nm on G.652.D, or 1471 nm on low_water_peak: false → silent", () => {
    expect(issues(p2p("cwdm-1391", "g652d-std", 10), "fibre.water_peak")).toHaveLength(0);
    expect(issues(p2p("cwdm-1471", "g652-wet", 10), "fibre.water_peak")).toHaveLength(0);
  });
});

describe("T34 DCM matched to the fibre (R9, DCM part)", () => {
  const withDcm = (dcm: string, type = "g652d-std") =>
    compute(
      project(
        [
          { id: "tx", model: "grey-1550" },
          { id: "dcm", model: dcm },
          { id: "rx", model: "grey-1550" },
        ],
        [fibre("span", type, "tx.tx", "dcm.in", { length_km: 80, ja: "lc-upc", jb: "lc-upc" }), fibre("p", "lc-patch", "dcm.out", "rx.rx")],
      ),
      catalog(),
    );
  it("DCM for_fibre G.655 after 80 km G.652.D → dcm.fibre_mismatch warn (patch cord ignored)", () => {
    const i = issues(withDcm("dcm-g655"), "dcm.fibre_mismatch", "dcm");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("warn");
    expect(i[0].values!.fibre).toBe("span");
  });
  it("matching standard, matching model id, or no for_fibre → silent", () => {
    expect(issues(withDcm("dcm-g652d"), "dcm.fibre_mismatch")).toHaveLength(0);
    expect(issues(withDcm("dcm-id"), "dcm.fibre_mismatch")).toHaveLength(0);
    expect(issues(withDcm("dcm-800"), "dcm.fibre_mismatch")).toHaveLength(0);
  });
  it("only fibres since the previous DCM count", () => {
    // G.655 → DCM(G.655) → G.652.D → DCM(G.652.D): both matched
    const r = compute(
      project(
        [
          { id: "tx", model: "grey-1550", settings: { tx_power_override_dBm: 4 } },
          { id: "d1", model: "dcm-g655" },
          { id: "d2", model: "dcm-g652d" },
          { id: "rx", model: "grey-1550" },
        ],
        [
          fibre("s1", "g655", "tx.tx", "d1.in", { length_km: 20, ja: "lc-upc", jb: "lc-upc" }),
          fibre("s2", "g652d-std", "d1.out", "d2.in", { length_km: 20, ja: "lc-upc", jb: "lc-upc" }),
          fibre("p", "lc-patch", "d2.out", "rx.rx"),
        ],
      ),
      catalog(),
    );
    expect(issues(r, "dcm.fibre_mismatch")).toHaveLength(0);
  });
});

describe("T38 laser safety class (R13)", () => {
  const cls = (tx: string, pwr: number) => {
    const r = p2p(tx, "g652d", 10, { pwr });
    return { r, c: r.fibres.find((f) => f.id === "f1")!.directions[0].laserClass };
  };
  it("1550 nm total +20 dBm → 3B (IRB: 17 < 20 ≤ 27), info", () => {
    // SPEC T38 says 3R, but its own R13 limits put +20 dBm above the 3R limit of +17 dBm
    const { r, c } = cls("grey-1550", 20);
    expect(c).toBe("3B");
    const i = issues(r, "safety.laser_class", "f1");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("info");
  });
  it("1550 nm +15 dBm → 3R (10 < 15 ≤ 17); +28 → 4", () => {
    expect(cls("grey-1550", 15).c).toBe("3R");
    expect(cls("grey-1550", 28).c).toBe("4");
  });
  it("1550 nm +10 dBm → 1, silent", () => {
    const { r, c } = cls("grey-1550", 10);
    expect(c).toBe("1");
    expect(issues(r, "safety.laser_class")).toHaveLength(0);
  });
  it("1310 nm +8 dBm → 3R (IRA limits −3 dB: 7 < 8 ≤ 14); +7 → 1", () => {
    expect(cls("grey-1310", 8).c).toBe("3R");
    expect(cls("grey-1310", 7).c).toBe("1");
  });
});

/**
 * Tunable Tx bank → mux (3.0 dB) → lossless patch → demux-iso common (IL 3.0, isolation 25 dB).
 * Channel ports of the demux are left open (the signal's port record is what R17 reads).
 */
function xtalk(ch: Record<string, number>, coherent: string[] = [], demux = "demux-iso") {
  const ids = Object.keys(ch);
  return compute(
    project(
      [
        ...ids.map((c) => ({ id: `t${c}`, model: coherent.includes(c) ? "dwdm-coh" : "dwdm-tunable", settings: { channel: c, tx_power_override_dBm: ch[c] + 3 } })),
        { id: "mux", model: "mux40-s" },
        { id: "dmx", model: demux },
      ],
      [...ids.map((c) => ideal(`p${c}`, `t${c}.tx`, `mux.${c}`)), ideal("trunk", "mux.common", "dmx.common")],
    ),
    catalog(),
  );
}

describe("T41 adjacent-channel crosstalk (R17)", () => {
  // SPEC uses C20/C21/C22; C20 is not in dwdm-c-100ghz-40 (C21…C60), so the grid is shifted one slot: C21/C22/C23.
  it("C22 at −10 dBm, C21 and C23 at −5 dBm into common → fail, margin −3.01", () => {
    const r = xtalk({ C21: -5, C22: -10, C23: -5 });
    const i = issues(r, "mux.crosstalk", "dmx");
    expect(i).toHaveLength(1);
    expect(i[0].port).toBe("C22");
    expect(i[0].severity).toBe("error");
    // crosstalk = 10·log10(2 × 10^((−5 − 3 − 25)/10)) = −33 + 3.01 = −29.99 dBm
    near(Number(i[0].values!.crosstalk_dBm), -29.99);
    // signal = −10 − 3 = −13 dBm; ratio = −13 + 29.99 = 16.99 < 20
    near(Number(i[0].values!.signal_dBm), -13);
    near(Number(i[0].values!.ratio_dB), 16.99);
    near(Number(i[0].values!.margin), -3.01);
    // C21 / C23: one neighbour C22 at −10 − 3 − 25 = −38 dBm vs signal −8 → ratio 30 → pass, silent
  });
  it("only the nearest slot each side within 1.5 × spacing: C21, C22, C24 → C21 only → ratio 20 → warn (margin 0)", () => {
    // crosstalk = −5 − 3 − 25 = −33; ratio = −13 + 33 = 20; C24 is 200 GHz away (> 150)
    const i = issues(xtalk({ C21: -5, C22: -10, C24: -5 }), "mux.crosstalk", "dmx");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("warn");
    near(Number(i[0].values!.margin), 0);
    expect(i[0].values!.neighbours).toBe("C21");
  });
  it("coherent C22 → skipped", () => {
    expect(issues(xtalk({ C21: -5, C22: -10, C23: -5 }, ["C22"]), "mux.crosstalk")).toHaveLength(0);
  });
  it("demux without isolation_dB → silent", () => {
    expect(issues(xtalk({ C21: -5, C22: -10, C23: -5 }, [], "mux40-s"), "mux.crosstalk")).toHaveLength(0);
  });
});

describe("T42 mixed direct-detect and coherent (R18)", () => {
  const span = (coh: string, amplified = true) => {
    const chans = ["C21", coh];
    const nodes = chans.map((c) => ({ id: `t${c}`, model: c === coh ? "dwdm-coh" : "dwdm-tunable", settings: { channel: c } }));
    const fibres = chans.map((c) => ideal(`p${c}`, `t${c}.tx`, `mux.${c}`));
    const amp = amplified
      ? { nodes: [{ id: "amp", model: "edfa", settings: { mode: "constant_gain" as const, gain_dB: 10 } }], fibres: [ideal("pa", "mux.common", "amp.in")], from: "amp.out" }
      : { nodes: [], fibres: [], from: "mux.common" };
    return compute(
      project(
        [...nodes, ...amp.nodes, { id: "mux", model: "mux40-s" }, { id: "dmx", model: "mux40-s" }],
        [...fibres, ...amp.fibres, fibre("span", "g652d", amp.from, "dmx.common", { length_km: 80, ja: "lc-upc", jb: "lc-upc" })],
      ),
      catalog(),
    );
  };
  it("amplified 80 km with direct C21 and coherent C22 (100 GHz apart) → warn", () => {
    const i = issues(span("C22"), "fibre.xpm_risk", "span");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("warn");
    near(Number(i[0].values!.delta_GHz), 100);
  });
  it("coherent at C25 (400 GHz) → silent", () => {
    expect(issues(span("C25"), "fibre.xpm_risk")).toHaveLength(0);
  });
  it("unamplified → silent", () => {
    expect(issues(span("C22", false), "fibre.xpm_risk")).toHaveLength(0);
  });
});

describe("standard names", () => {
  it("normStandard ignores an ITU-T prefix, case and spaces", () => {
    expect(normStandard("ITU-T G.652.D")).toBe(normStandard("g.652.d"));
    expect(normStandard("ITU-T G.652")).toBe("G.652");
    expect(normStandard("G.655")).not.toBe(normStandard("G.652.D"));
  });
});
