/** SPEC §12 design rules (7.10), per-signal part: T26, T27, T29, T30, T34 (cd_spread), T35–T40, T43, T44 (out of band). */
import { describe, expect, it } from "vitest";
import type { Margins } from "@lumantite/schema";
import { compute, resolveCatalog, toSignalsCsv } from "../src/index.js";
import { amp, CATALOG_ENTRIES, check, fibre, ideal, issues, near, nearT, project, PSNM, sig } from "./fixtures.js";

const LOCAL: unknown[] = [
  { kind: "transceiver", id: "grey-1530", extends: "grey-1550", tx: { wavelength: { wavelength_nm: 1530 } } },
  { kind: "transceiver", id: "coh-1550", extends: "grey-1550", detection: "coherent" },
  { kind: "transceiver", id: "coh-1530", extends: "grey-1530", detection: "coherent" },
  { kind: "transceiver", id: "grey-dmg", extends: "grey-1550", rx: { damage_dBm: 3 } },
  { kind: "transceiver", id: "grey-10km", extends: "grey-1550", reach_km: 10 },
  { kind: "transceiver", id: "lr4", tx: { wavelength: { wavelength_nm: 1310 }, power_dBm: 0, lanes: 4 }, rx: { sensitivity_dBm: -10, overload_dBm: 4 }, connector: "lc-upc" },
  { kind: "transceiver", id: "dwdm-64g", extends: "dwdm-tunable", baud_GBd: 64 },
  { kind: "transceiver", id: "dwdm-32g", extends: "dwdm-tunable", baud_GBd: 32 },
  { kind: "transceiver", id: "dwdm-64g-bw40", extends: "dwdm-64g", signal_bandwidth_GHz: 40 },
  { kind: "transceiver", id: "rx-dgd10", extends: "grey-1550", rx: { dgd_tolerance_ps: 10 } },
  { kind: "transceiver", id: "rx-10g", extends: "grey-1550", baud_GBd: 10 },
  { kind: "transceiver", id: "rx-osnr27", extends: "grey-1550", rx: { min_osnr_dB: 27, overload_dBm: 5 } },
  { kind: "transceiver", id: "tx-osnr35", extends: "grey-1550", tx: { osnr_dB: 35 } },
  { kind: "fibre", id: "g652d-u", extends: "g652d", dispersion_uncertainty_ps_nm_km: 0.5 },
  { kind: "fibre", id: "pmd05", extends: "g652d", pmd_ps_per_sqrt_km: 0.5 },
  { kind: "fibre", id: "pmd10", extends: "g652d", pmd_ps_per_sqrt_km: 1.0 },
  { kind: "fibre", id: "pmd02", extends: "g652d", pmd_ps_per_sqrt_km: 0.2 },
  { kind: "mux", id: "mux-pb50", extends: "mux40-s", passband_ghz: 50 },
  { kind: "mux", id: "mux-mon", extends: "mux40-s", monitor_port: { tap_dB: 13.0103 } },
  /** Wide gain range so the R2 scenarios are not clamped by gain_dB. */
  {
    kind: "amplifier",
    id: "edfa-wide-nodc",
    band_nm: [1528, 1566],
    modes: ["constant_gain", "constant_output_power"],
    gain_dB: { min: 0, max: 40 },
    input_power_total_dBm: { min: -40, max: 10 },
    output_power_total_dBm: { max: 20 },
    connector: "lc-upc",
  },
  { kind: "amplifier", id: "edfa-wide", extends: "edfa-wide-nodc", design_channels: 40 },
  { kind: "amplifier", id: "edfa-nf5", extends: "edfa-wide", noise_figure_dB: 5 },
];
const r0 = resolveCatalog([...CATALOG_ENTRIES, ...LOCAL]);
if (r0.issues.length) throw new Error("local catalog invalid: " + JSON.stringify(r0.issues));
const cat = r0.catalog;

/** Warn / error issues other than the unused reverse-direction topology warnings of one-way test links. */
const errorsAndWarnings = (r: ReturnType<typeof compute>) => r.issues.filter((i) => i.severity !== "info" && !i.code.startsWith("topology."));

// ---------------------------------------------------------------------------
describe("T26 direct-detect Rx behind a splitter (R1)", () => {
  // tx1, tx2 → comb (50/50 used as a combiner, out1/out2 → in) → split (in → out1/out2) → rx1, rx2
  const net = (a: string, b: string, rx: string) =>
    project(
      [
        { id: "tx1", model: a },
        { id: "tx2", model: b },
        { id: "comb", model: "split-50" },
        { id: "split", model: "split-50" },
        { id: "rx1", model: rx },
        { id: "rx2", model: rx },
      ],
      [
        ideal("p1", "tx1.tx", "comb.out1"),
        ideal("p2", "tx2.tx", "comb.out2"),
        ideal("p3", "comb.in", "split.in"),
        ideal("p4", "split.out1", "rx1.rx"),
        ideal("p5", "split.out2", "rx2.rx"),
      ],
    );
  const r = compute(net("grey-1550", "grey-1530", "grey-1550"), cat);
  it("each Rx gets two signals at 0 − 3.01 − 3.01 = −6.02 dBm", () => {
    const at1 = r.signals.filter((s) => s.rx?.node === "rx1");
    expect(at1).toHaveLength(2);
    for (const s of at1) near(s.powerAtEnd.typ, -6.02);
  });
  it("every signal fails rx.multiple_signals", () => {
    const atRx = r.signals.filter((s) => s.terminated === "rx");
    expect(atRx).toHaveLength(4);
    for (const s of atRx) expect(check(s, "rx.multiple_signals").status).toBe("fail");
    expect(issues(r, "rx.multiple_signals")).toHaveLength(4);
  });
  it("overload uses Σ P.max: 10·log10(2 × 10^(−0.602)) = −3.01 dBm; margin −7 − (−3.01) = −3.99", () => {
    const c = check(sig(r, "tx1.tx:1550nm"), "rx.power_high");
    near(Number(c.values!.power_max), -3.01);
    near(c.margin!, -3.99);
  });
  it("coherent receivers: no rx.multiple_signals, overload per signal (−7 − (−6.02) = −0.98)", () => {
    const rc = compute(net("coh-1550", "coh-1530", "coh-1550"), cat);
    expect(issues(rc, "rx.multiple_signals")).toHaveLength(0);
    const s = sig(rc, "tx1.tx:1550nm");
    expect(s.checks.some((c) => c.code === "rx.multiple_signals")).toBe(false);
    const c = check(s, "rx.power_high");
    near(Number(c.values!.power_max), -6.02);
    near(c.margin!, -0.98);
  });
  it("a single signal at a direct-detect Rx is not flagged", () => {
    const r1 = compute(project([{ id: "tx", model: "grey-1550" }, { id: "rx", model: "grey-1550" }], [ideal("p", "tx.tx", "rx.rx")]), cat);
    expect(issues(r1, "rx.multiple_signals")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("T27 channel loading (R2)", () => {
  const CH = ["C21", "C22", "C23", "C24"];
  // 4 × Tx → mux (3.0) → amp → 80 km @ 0.2 (16 dB, ideal joints) → demux (3.0) → 4 × Rx (sens −14, overload 0)
  const net = (ampSettings: Record<string, unknown>, txOverride?: number, ampModel = "edfa-wide") =>
    project(
      [
        ...CH.map((ch) => ({ id: `tx${ch}`, model: "dwdm-tunable", settings: { channel: ch, ...(txOverride !== undefined ? { tx_power_override_dBm: txOverride } : {}) } })),
        ...CH.map((ch) => ({ id: `rx${ch}`, model: "dwdm-tunable", settings: { channel: ch } })),
        { id: "mux", model: "mux40-s" },
        { id: "demux", model: "mux40-s" },
        { id: "amp", model: ampModel, settings: ampSettings },
      ],
      [
        ...CH.map((ch) => ideal(`pt${ch}`, `tx${ch}.tx`, `mux.${ch}`)),
        ...CH.map((ch) => ideal(`pr${ch}`, `demux.${ch}`, `rx${ch}.rx`)),
        ideal("pm", "mux.common", "amp.in"),
        fibre("span", "g652d", "amp.out", "demux.common", { length_km: 80, attenuation_dB_per_km: 0.2, ja: "lc-ideal", jb: "lc-ideal" }),
      ],
    );

  describe("CoP 17 dBm, 4 lit, design_channels 40", () => {
    const r = compute(net({ mode: "constant_output_power", output_power_dBm: 17 }), cat);
    const a = amp(r, "amp");
    it("Pin_total = −3 + 6.02 = 3.02; G = 17 − 3.02 = 13.98", () => {
      near(a.pinTotal.typ, 3.02);
      near(a.gainEffective.typ, 13.98);
    });
    it("full: ΔG = −10·log10(40/4) = −10.00; single: ΔG = +10·log10(4) = +6.02", () => {
      expect(a.loading).toBeDefined();
      expect(a.loading!.designChannels).toBe(40);
      expect(a.loading!.litChannels).toBe(4);
      near(a.loading!.full_dB, -10.0);
      near(a.loading!.single_dB, 6.02);
      const s = sig(r, "txC21.tx:C21");
      near(s.loading!.full_dB, -10.0);
      near(s.loading!.single_dB, 6.02);
    });
    it("Rx −3 + 13.98 − 16 − 3 = −8.02: normal pass, full load fails, single load passes", () => {
      const s = sig(r, "txC21.tx:C21");
      near(s.powerAtEnd.typ, -8.02);
      expect(check(s, "rx.power_low").status).toBe("pass"); // −8.02 − 4.2 = −12.22 vs −14 → +1.78
      const cl = s.checks.filter((c) => c.code === "amp.channel_loading");
      const full = cl.find((c) => c.values?.case === "full")!;
      const single = cl.find((c) => c.values?.case === "single")!;
      // full: −8.02 − 10 − 4.2 = −22.22 vs −14 → −8.22
      expect(full.status).toBe("fail");
      near(full.margin!, -8.22);
      // single: −8.02 + 6.02 = −2.00 vs overload 0 → +2.00
      expect(single.status).toBe("pass");
      near(single.margin!, 2.0);
      expect(issues(r, "amp.channel_loading", "rxC21")).toHaveLength(1);
    });
    it("settings.design_channels overrides the model: 8 → full ΔG = −10·log10(8/4) = −3.01", () => {
      const r8 = compute(net({ mode: "constant_output_power", output_power_dBm: 17, design_channels: 8 }), cat);
      near(amp(r8, "amp").loading!.full_dB, -3.01);
    });
    it("without design_channels N_design = channels of dwdm-c-100ghz-40 inside 1528…1566 nm = 40", () => {
      const a = amp(compute(net({ mode: "constant_output_power", output_power_dBm: 17 }, undefined, "edfa-wide-nodc"), cat), "amp");
      expect(a.loading!.designChannels).toBe(40);
      near(a.loading!.full_dB, -10.0);
    });
  });

  describe("constant gain far from saturation", () => {
    it("Tx −10: Pin_total −13 + 6.02 = −6.98, G 10 → full Pin' 3.02 + 10 = 13.02 ≤ 20 → ΔG 0; single 0", () => {
      const r = compute(net({ mode: "constant_gain", gain_dB: 10 }, -10), cat);
      const a = amp(r, "amp");
      near(a.loading!.full_dB, 0);
      near(a.loading!.single_dB, 0);
      expect(issues(r, "amp.channel_loading")).toHaveLength(0);
    });
    it("Tx 0: Pin_total 3.02, G 10 → full Pin' 13.02 + 10 > 20 → G' = 20 − 13.02 = 6.98, ΔG −3.02", () => {
      const r = compute(net({ mode: "constant_gain", gain_dB: 10 }), cat);
      near(amp(r, "amp").loading!.full_dB, -3.02);
    });
  });

  describe("reset at the last constant-output-power amplifier", () => {
    // Tx −10 → mux (−13/ch, total −6.98) → ampA → 16 dB → ampB → 16 dB → demux → Rx
    const two = (bSettings: Record<string, unknown>) =>
      project(
        [
          ...CH.map((ch) => ({ id: `tx${ch}`, model: "dwdm-tunable", settings: { channel: ch, tx_power_override_dBm: -10 } })),
          ...CH.map((ch) => ({ id: `rx${ch}`, model: "dwdm-tunable", settings: { channel: ch } })),
          { id: "mux", model: "mux40-s" },
          { id: "demux", model: "mux40-s" },
          { id: "ampA", model: "edfa-wide", settings: { mode: "constant_gain", gain_dB: 25 } },
          { id: "ampB", model: "edfa-wide", settings: bSettings },
        ],
        [
          ...CH.map((ch) => ideal(`pt${ch}`, `tx${ch}.tx`, `mux.${ch}`)),
          ...CH.map((ch) => ideal(`pr${ch}`, `demux.${ch}`, `rx${ch}.rx`)),
          ideal("pm", "mux.common", "ampA.in"),
          fibre("s1", "g652d", "ampA.out", "ampB.in", { length_km: 80, attenuation_dB_per_km: 0.2, ja: "lc-ideal", jb: "lc-ideal" }),
          fibre("s2", "g652d", "ampB.out", "demux.common", { length_km: 80, attenuation_dB_per_km: 0.2, ja: "lc-ideal", jb: "lc-ideal" }),
        ],
      );
    it("ampA (CG 25): full Pin' 3.02 + 25 > 20 → G' 16.98 → ΔG −8.02", () => {
      const r = compute(two({ mode: "constant_output_power", output_power_dBm: 17 }), cat);
      near(amp(r, "ampA").loading!.full_dB, -8.02);
    });
    it("ampB CoP 17 (Pin −13 + 25 − 16 = −4/ch, total 2.02): Δ counts ampB only (−10, +6.02)", () => {
      const r = compute(two({ mode: "constant_output_power", output_power_dBm: 17 }), cat);
      const s = sig(r, "txC21.tx:C21");
      near(s.loading!.full_dB, -10.0);
      near(s.loading!.single_dB, 6.02);
    });
    it("ampB CG 15 (no CoP): Δ sums both; ampB full: 12.02 + 15 > 20 → G' 7.98, ΔG −7.02 → −8.02 − 7.02 = −15.04", () => {
      const r = compute(two({ mode: "constant_gain", gain_dB: 15 }), cat);
      near(amp(r, "ampB").loading!.full_dB, -7.02);
      near(sig(r, "txC21.tx:C21").loading!.full_dB, -15.04);
      near(sig(r, "txC21.tx:C21").loading!.single_dB, 0);
    });
  });
});

// ---------------------------------------------------------------------------
describe("T29 amp channel input (R4)", () => {
  // Tx (override) → mux 3.0 → amp: channel Pin = Tx − 3
  const net = (tx: number, margins?: Margins) =>
    project(
      [
        { id: "tx", model: "dwdm-tunable", settings: { channel: "C21", tx_power_override_dBm: tx } },
        { id: "mux", model: "mux40-s" },
        { id: "amp", model: "edfa-wide", settings: { mode: "constant_gain", gain_dB: 20 } },
        { id: "rx", model: "dwdm-tunable", settings: { channel: "C21" } },
      ],
      [ideal("p1", "tx.tx", "mux.C21"), ideal("p2", "mux.common", "amp.in"), ideal("p3", "amp.out", "rx.rx")],
      margins,
    );
  it("Pin.min −24 − 3 = −27 dBm, limit −25 → warn (margin −2), never an error", () => {
    const r = compute(net(-24), cat);
    const l = issues(r, "amp.channel_input_low", "amp");
    expect(l).toHaveLength(1);
    expect(l[0].severity).toBe("warn");
    expect(l[0].channel).toBe("C21");
    near(Number(l[0].values!.margin), -2);
    expect(amp(r, "amp").status).toBe("warn");
  });
  it("−22 − 3 = −25 (at the limit) → silent", () => {
    expect(issues(compute(net(-22), cat), "amp.channel_input_low")).toHaveLength(0);
  });
  it("margins.amp_min_channel_input_dBm −30 → silent at −27", () => {
    expect(issues(compute(net(-24, { amp_min_channel_input_dBm: -30 }), cat), "amp.channel_input_low")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("T30 damage and attenuator hint (R5)", () => {
  // Tx {0, 2, 4} back to back (lossless) into Rx overload −7, damage +3
  const r = compute(project([{ id: "tx", model: "grey-1550-t5" }, { id: "rx", model: "grey-dmg" }], [ideal("p", "tx.tx", "rx.rx")]), cat);
  const s = sig(r, "tx.tx:1550nm");
  it("rx.power_damage fail, margin 3 − 4 = −1", () => {
    const c = check(s, "rx.power_damage");
    expect(c.status).toBe("fail");
    near(c.margin!, -1);
    expect(issues(r, "rx.power_damage", "rx")).toHaveLength(1);
  });
  it("rx.power_high fail, suggested_attenuation_dB = 4 + 7 + 1 = 12, max = Rx-low margin 0 − 4.2 + 24 = 19.8", () => {
    const c = check(s, "rx.power_high");
    expect(c.status).toBe("fail");
    near(Number(c.values!.suggested_attenuation_dB), 12);
    near(Number(c.values!.max_attenuation_dB), 19.8);
    expect(c.message).toContain("12.00 dB");
  });
  it("no damage threshold → no check", () => {
    const r2 = compute(project([{ id: "tx", model: "grey-1550-t5" }, { id: "rx", model: "grey-1550" }], [ideal("p", "tx.tx", "rx.rx")]), cat);
    expect(sig(r2, "tx.tx:1550nm").checks.some((c) => c.code === "rx.power_damage")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("T34 CD spread (R9)", () => {
  const net = (type: string, km: number) =>
    project(
      [
        { id: "tx", model: "grey-1550", settings: { tx_power_override_dBm: -5 } },
        { id: "rx", model: "grey-1550" },
      ],
      [fibre("f", type, "tx.tx", "rx.rx", { length_km: km, ja: "lc-ideal", jb: "lc-ideal" })],
    );
  it("0.5 ps/(nm·km) × 80 km → cd_spread 40 ps/nm; (1396.8 + 40) × 1.1 = 1580.5 ≤ 1600 → pass", () => {
    const s = sig(compute(net("g652d-u", 80), cat), "tx.tx:1550nm");
    near(s.cdSpread, 40, PSNM);
    const c = check(s, "rx.cd");
    expect(c.status).toBe("pass");
    near(c.margin!, 1600 - 1580.5, 0.2);
  });
  it("82 km: (1431.8 + 41) × 1.1 = 1620.1 > 1600 → fail", () => {
    const c = check(sig(compute(net("g652d-u", 82), cat), "tx.tx:1550nm"), "rx.cd");
    expect(c.status).toBe("fail");
    near(c.margin!, 1600 - 1620.1, 0.2);
  });
  it("82 km without uncertainty: 1431.8 × 1.1 = 1575.0 → pass, cd_spread 0", () => {
    const s = sig(compute(net("g652d", 82), cat), "tx.tx:1550nm");
    expect(s.cdSpread).toBe(0);
    expect(check(s, "rx.cd").status).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
describe("T35 passband (R10)", () => {
  // Tx C21 → mux (passband 50 GHz) C21 → common → Rx
  const net = (tx: string) =>
    project(
      [
        { id: "tx", model: tx, settings: { channel: "C21" } },
        { id: "mux", model: "mux-pb50" },
        { id: "rx", model: "dwdm-tunable", settings: { channel: "C21" } },
      ],
      [ideal("p1", "tx.tx", "mux.C21"), ideal("p2", "mux.common", "rx.rx")],
    );
  it("64 GBd → 1.15 × 64 = 73.6 GHz > 50 → fail; the signal still reaches the Rx", () => {
    const r = compute(net("dwdm-64g"), cat);
    const s = sig(r, "tx.tx:C21");
    expect(s.terminated).toBe("rx");
    near(s.powerAtEnd.typ, -3);
    const c = check(s, "mux.passband_exceeded");
    expect(c.status).toBe("fail");
    near(c.margin!, 50 - 73.6);
    expect(s.status).toBe("fail");
    const i = issues(r, "mux.passband_exceeded", "mux");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("error");
    expect(i[0].port).toBe("C21");
  });
  it("32 GBd → 36.8 GHz → pass (no check)", () => {
    const r = compute(net("dwdm-32g"), cat);
    expect(issues(r, "mux.passband_exceeded")).toHaveLength(0);
    expect(sig(r, "tx.tx:C21").checks.some((c) => c.code === "mux.passband_exceeded")).toBe(false);
  });
  it("explicit signal_bandwidth_GHz 40 wins over 64 GBd → pass", () => {
    expect(issues(compute(net("dwdm-64g-bw40"), cat), "mux.passband_exceeded")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("T36 reach (R11)", () => {
  // Tx −8 dBm, 10 km optic, 11 km @ 0.2 dB/km → Rx −10.2: overload margin 3.2, sensitivity margin −10.2 − 4.2 + 24 = 9.6
  const net = (km: number) =>
    project(
      [
        { id: "tx", model: "grey-10km", settings: { tx_power_override_dBm: -8 } },
        { id: "rx", model: "grey-1550" },
      ],
      [fibre("f", "g652d", "tx.tx", "rx.rx", { length_km: km, ja: "lc-ideal", jb: "lc-ideal" })],
    );
  it("11 km on a 10 km optic with a passing budget → one info rx.reach, no warn/fail", () => {
    const r = compute(net(11), cat);
    const i = issues(r, "rx.reach");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("info");
    expect(i[0].values!.path_km).toBe(11);
    expect(i[0].values!.reach_km).toBe(10);
    near(Number(i[0].values!.margin), 9.6);
    expect(errorsAndWarnings(r).map((i) => i.code + ": " + i.message)).toEqual([]);
    expect(sig(r, "tx.tx:1550nm").status).toBe("pass");
  });
  it("10 km → silent", () => {
    expect(issues(compute(net(10), cat), "rx.reach")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("T37 monitor tap (R12)", () => {
  // 95/5 tap: −10·log10(1 − 10^(−1.30103)) = −10·log10(0.95) = 0.2228 dB on common
  it("mux direction: C21 → common: 3.0 + 0.2228 = 3.2228 dB", () => {
    const r = compute(
      project(
        [
          { id: "tx", model: "dwdm-tunable", settings: { channel: "C21" } },
          { id: "mux", model: "mux-mon" },
          { id: "rx", model: "dwdm-tunable", settings: { channel: "C21" } },
        ],
        [ideal("p1", "tx.tx", "mux.C21"), ideal("p2", "mux.common", "rx.rx")],
      ),
      cat,
    );
    nearT(sig(r, "tx.tx:C21").powerAtEnd, { min: -3.2228, typ: -3.2228, max: -3.2228 }, 0.001);
  });
  it("demux direction: common → C21: same 3.2228 dB; the monitor port stays unrouted", () => {
    const r = compute(
      project(
        [
          { id: "tx", model: "dwdm-tunable", settings: { channel: "C21" } },
          { id: "mux", model: "mux-mon" },
          { id: "rx", model: "dwdm-tunable", settings: { channel: "C21" } },
        ],
        [ideal("p1", "tx.tx", "mux.common"), ideal("p2", "mux.C21", "rx.rx")],
      ),
      cat,
    );
    near(sig(r, "tx.tx:C21").powerAtEnd.typ, -3.2228, 0.001);
    expect(r.ports.find((p) => p.node === "mux" && p.port === "monitor")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("T38 lanes (R14)", () => {
  // LR4: 4 lanes × 0 dBm, 10 km @ 1310 (0.35 dB/km → 3.5 dB), ideal joints
  const r = compute(
    project([{ id: "tx", model: "lr4" }, { id: "rx", model: "lr4" }], [fibre("f", "g652d", "tx.tx", "rx.rx", { length_km: 10, ja: "lc-ideal", jb: "lc-ideal" })]),
    cat,
  );
  it("fibre total = 0 + 10·log10(4) = +6.02 dBm; Tx port total the same", () => {
    near(r.fibres.find((f) => f.id === "f")!.directions[0].totalPower!.max, 6.02);
    near(r.ports.find((p) => p.node === "tx" && p.port === "tx")!.out.totalPower!.typ, 6.02);
  });
  it("Rx checks per lane: 0 − 3.5 = −3.5 dBm", () => {
    const s = sig(r, "tx.tx:1310nm");
    near(s.powerAtEnd.typ, -3.5);
    near(Number(check(s, "rx.power_high").values!.power_max), -3.5);
    // Rx port total counts the lanes: −3.5 + 6.02 = 2.52
    near(r.ports.find((p) => p.node === "rx" && p.port === "rx")!.in.totalPower!.typ, 2.52);
  });
});

// ---------------------------------------------------------------------------
describe("T39 PMD (R15)", () => {
  const one = (type: string, km: number, rx = "rx-dgd10") =>
    project([{ id: "tx", model: "grey-1550" }, { id: "rx", model: rx }], [fibre("f", type, "tx.tx", "rx.rx", { length_km: km, ja: "lc-ideal", jb: "lc-ideal" })]);
  it("0.5 ps/√km × 100 km → √(0.25 × 100) = 5.0 ps, tolerance 10 → pass (margin 5)", () => {
    const s = sig(compute(one("pmd05", 100), cat), "tx.tx:1550nm");
    near(s.dgd_ps!, 5.0);
    const c = check(s, "rx.pmd");
    expect(c.status).toBe("pass");
    near(c.margin!, 5);
  });
  it("1.0 ps/√km × 400 km → 20 ps → fail", () => {
    const s = sig(compute(one("pmd10", 400), cat), "tx.tx:1550nm");
    near(s.dgd_ps!, 20);
    expect(check(s, "rx.pmd").status).toBe("fail");
  });
  it("0.5/√km × 64 km + 0.2/√km × 100 km → √(16 + 4) = 4.47 ps", () => {
    const r = compute(
      project(
        [{ id: "tx", model: "grey-1550" }, { id: "rx", model: "rx-dgd10" }],
        [fibre("f1", "pmd05", "tx.tx", "f2.a", { length_km: 64, ja: "lc-ideal" }), fibre("f2", "pmd02", "f1.b", "rx.rx", { length_km: 100, jb: "lc-ideal" })],
      ),
      cat,
    );
    near(sig(r, "tx.tx:1550nm").dgd_ps!, Math.sqrt(20));
  });
  it("default tolerance: direct detect, 10 GBd → 0.1 × 1000 / 10 = 10 ps", () => {
    const c = check(sig(compute(one("pmd05", 100, "rx-10g"), cat), "tx.tx:1550nm"), "rx.pmd");
    near(Number(c.values!.tolerance_ps), 10);
  });
  it("no tolerance → no check; no PMD coefficient → dgd_ps absent", () => {
    const s = sig(compute(one("pmd05", 100, "grey-1550"), cat), "tx.tx:1550nm");
    expect(s.checks.some((c) => c.code === "rx.pmd")).toBe(false);
    expect(sig(compute(one("g652d", 100), cat), "tx.tx:1550nm").dgd_ps).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("T40 OSNR (R16)", () => {
  // Tx −20 dBm → amp1 (G 20) → [80 km @ 0.25 = 20 dB → amp2 (G 20)] → Rx; Pin = −20 dBm/ch at every amp
  const net = (n: 1 | 2, tx = "grey-1550", ampModel = "edfa-nf5", rx = "rx-osnr27") =>
    project(
      [
        { id: "tx", model: tx, settings: { tx_power_override_dBm: -20 } },
        { id: "amp1", model: ampModel, settings: { mode: "constant_gain", gain_dB: 20 } },
        ...(n === 2 ? [{ id: "amp2", model: ampModel, settings: { mode: "constant_gain" as const, gain_dB: 20 } }] : []),
        { id: "rx", model: rx },
      ],
      n === 1
        ? [ideal("p1", "tx.tx", "amp1.in"), ideal("p2", "amp1.out", "rx.rx")]
        : [
            ideal("p1", "tx.tx", "amp1.in"),
            fibre("span", "g652d", "amp1.out", "amp2.in", { length_km: 80, attenuation_dB_per_km: 0.25, ja: "lc-ideal", jb: "lc-ideal" }),
            ideal("p2", "amp2.out", "rx.rx"),
          ],
    );
  it("one amp, Pin −20 dBm, NF 5 → 58 − 20 − 5 = 33.0 dB (pass: 33 − 3 − 27 = 3)", () => {
    const r = compute(net(1), cat);
    const s = sig(r, "tx.tx:1550nm");
    nearT(s.osnr!, { min: 33, typ: 33, max: 33 });
    expect(check(s, "rx.osnr").status).toBe("pass");
    near(amp(r, "amp1").perChannel[0].osnrOut!.min, 33);
  });
  it("two identical amps → 33 − 10·log10(2) = 29.99 dB → fail: 29.99 − 3 − 27 = −0.01", () => {
    const r = compute(net(2), cat);
    const s = sig(r, "tx.tx:1550nm");
    near(s.osnr!.min, 29.99);
    const c = check(s, "rx.osnr");
    expect(c.status).toBe("fail");
    near(c.margin!, -0.01);
    near(amp(r, "amp2").perChannel[0].osnrOut!.min, 29.99);
    expect(issues(r, "rx.osnr", "rx")).toHaveLength(1);
  });
  it("signals CSV carries OSNR (min 29.99) and the OSNR margin (−0.01)", () => {
    const rows = toSignalsCsv(compute(net(2), cat)).split("\r\n").map((l) => l.split(","));
    const h = rows[0];
    expect(rows[1][h.indexOf("osnr_min_dB")]).toBe("29.99");
    expect(rows[1][h.indexOf("margin_osnr_dB")]).toBe("-0.01");
  });
  it("with Tx OSNR 35 → 10·log10(1/(10^−3.5 + 2·10^−3.3)) = 28.80 dB", () => {
    near(sig(compute(net(2, "tx-osnr35"), cat), "tx.tx:1550nm").osnr!.min, 28.8);
  });
  it("amp without NF → OSNR unknown, rx.osnr n/a", () => {
    const s = sig(compute(net(1, "grey-1550", "edfa-wide"), cat), "tx.tx:1550nm");
    expect(s.osnr).toBeUndefined();
    expect(check(s, "rx.osnr").status).toBe("n/a");
  });
  it("no amplifier and no Tx OSNR → no check", () => {
    const r = compute(project([{ id: "tx", model: "grey-1550" }, { id: "rx", model: "rx-osnr27" }], [ideal("p", "tx.tx", "rx.rx")]), cat);
    const s = sig(r, "tx.tx:1550nm");
    expect(s.osnr).toBeUndefined();
    expect(s.checks.some((c) => c.code === "rx.osnr")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("T43 repair per km (R19)", () => {
  // Tx 0 → 80 km @ 0.2 = 16 dB (ideal joints) → Rx −16 dBm; penalty 3 + 1 + 2×0.1 = 4.2
  const net = (margins?: Margins) =>
    project([{ id: "tx", model: "grey-1550" }, { id: "rx", model: "grey-1550" }], [fibre("f", "g652d", "tx.tx", "rx.rx", { length_km: 80, ja: "lc-ideal", jb: "lc-ideal" })], margins);
  it("0.01 dB/km × 80 km = 0.8 dB added: penalty 5.0, margin −16 − 5.0 + 24 = 3.0", () => {
    const c = check(sig(compute(net({ repair_loss_dB_per_km: 0.01 }), cat), "tx.tx:1550nm"), "rx.power_low");
    near(Number(c.values!.penalty_dB), 5.0);
    near(c.margin!, 3.0);
  });
  it("default 0 → margin 3.8", () => {
    near(check(sig(compute(net(), cat), "tx.tx:1550nm"), "rx.power_low").margin!, 3.8);
  });
});

// ---------------------------------------------------------------------------
describe("T44 1310 nm through a C-band EDFA", () => {
  const r = compute(
    project(
      [
        { id: "tx", model: "grey-1310" },
        { id: "amp", model: "edfa", settings: { mode: "constant_gain", gain_dB: 10 } },
        { id: "rx", model: "grey-1310" },
      ],
      [ideal("p1", "tx.tx", "amp.in"), ideal("p2", "amp.out", "rx.rx")],
    ),
    cat,
  );
  it("amp.out_of_band is a fail (error) and the gain is still applied (0 + 10 = 10 dBm)", () => {
    const i = issues(r, "amp.out_of_band", "amp");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("error");
    expect(amp(r, "amp").status).toBe("fail");
    near(sig(r, "tx.tx:1310nm").powerAtEnd.typ, 10);
  });
});
