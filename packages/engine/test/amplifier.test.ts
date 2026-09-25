/** SPEC §12 "Amplifier": T13–T20. */
import { describe, expect, it } from "vitest";
import type { NodeSettings } from "@optiplanner/schema";
import { compute } from "../src/index.js";
import { amp, catalog, check, fibre, ideal, issues, near, project, sig } from "./fixtures.js";

/** Single grey Tx at `pin` dBm → lossless patch → amplifier → lossless patch → Rx. */
function single(ampModel: string, settings: NodeSettings, pin: number, txModel = "grey-1550") {
  return compute(
    project(
      [
        { id: "tx", model: txModel, settings: { tx_power_override_dBm: pin } },
        { id: "amp", model: ampModel, settings },
        { id: "rx", model: "grey-1550" },
      ],
      [ideal("p1", "tx.tx", "amp.in"), ideal("p2", "amp.out", "rx.rx")],
    ),
    catalog(),
  );
}

describe("T13 constant gain, unsaturated", () => {
  const r = single("edfa", { mode: "constant_gain", gain_dB: 20 }, -10);
  const a = amp(r, "amp");
  it("Pin_total −10, G 20, Pout_max 20 → Pout 10", () => {
    near(a.pinTotal.typ, -10);
    near(a.gainEffective.typ, 20);
    // −10 + 20 = 10
    near(a.poutTotal.typ, 10);
    // headroom = 20 − 10 = 10
    near(a.headroom_dB, 10);
    near(sig(r, "tx.tx:1550nm").powerAtEnd.typ, 10);
  });
  it("no warning", () => {
    expect(r.issues.filter((i) => i.element === "amp")).toHaveLength(0);
    expect(a.status).toBe("pass");
  });
});

describe("T14 constant gain, saturated", () => {
  const r = single("edfa", { mode: "constant_gain", gain_dB: 20 }, 2.74);
  const a = amp(r, "amp");
  it("Pin_total 2.74, G 20, Pout_max 20 → G_eff 17.26, warning", () => {
    // 2.74 + 20 = 22.74 > 20 → G = 20 − 2.74 = 17.26
    near(a.gainEffective.typ, 17.26);
    near(a.poutTotal.typ, 20);
    const i = issues(r, "amp.output_saturated", "amp");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("warn");
    expect(a.status).toBe("warn");
  });
});

describe("T15 constant output power", () => {
  const r = single("edfa", { mode: "constant_output_power", output_power_dBm: 10 }, -15);
  const a = amp(r, "amp");
  it("Pout set 10, Pin_total −15 → G 25, clamped to 23 → warning, Pout_total 8", () => {
    // G = 10 − (−15) = 25 > gain_dB.max 23 → 23 ; Pout = −15 + 23 = 8
    near(a.gainEffective.typ, 23);
    near(a.poutTotal.typ, 8);
    expect(issues(r, "amp.gain_clamped", "amp")).toHaveLength(1);
    expect(issues(r, "amp.gain_clamped", "amp")[0].severity).toBe("warn");
    // clamped gain is inside the range → no gain_out_of_range error
    expect(issues(r, "amp.gain_out_of_range")).toHaveLength(0);
  });
});

describe("T16 tilt (parametric)", () => {
  // C60 = 196.0 THz → 299792.458/196.0 = 1529.553 nm ; C21 = 192.1 THz → 1560.606 nm
  const m = project(
    [
      { id: "t60", model: "dwdm-tunable", settings: { channel: "C60", tx_power_override_dBm: -20 } },
      { id: "t21", model: "dwdm-tunable", settings: { channel: "C21", tx_power_override_dBm: -20 } },
      { id: "mux", model: "mux40-s" },
      { id: "amp", model: "edfa-tilt", settings: { mode: "constant_gain", gain_dB: 20 } },
    ],
    [ideal("p60", "t60.tx", "mux.C60"), ideal("p21", "t21.tx", "mux.C21"), ideal("pm", "mux.common", "amp.in")],
  );
  const r = compute(m, catalog());
  const a = amp(r, "amp");
  const g = (ch: string) => a.perChannel.find((c) => c.channel.id === ch)!.gain;
  it("per-channel gain 20 + 0.459 and 20 − 0.358 (linear interpolation of the tilt table)", () => {
    // tilt(1529.553) = 0.5 − 1.0 × (1529.553 − 1528)/38 = 0.5 − 0.0409 = 0.459
    near(g("C60").typ, 20.459);
    // tilt(1560.606) = 0.5 − 1.0 × (1560.606 − 1528)/38 = 0.5 − 0.858 = −0.358
    near(g("C21").typ, 19.642);
  });
  it("instance tilt_dB adds a linear tilt across the band (+ = more gain at long λ)", () => {
    const m2 = structuredClone(m);
    m2.nodes.find((n) => n.id === "amp")!.settings = { mode: "constant_gain", gain_dB: 20, tilt_dB: 2 };
    const a2 = amp(compute(m2, catalog()), "amp");
    // instance tilt = 2 × (λ − 1547)/38 : C21 → 2 × 13.606/38 = +0.716 ; C60 → 2 × (−17.447)/38 = −0.918
    near(a2.perChannel.find((c) => c.channel.id === "C21")!.gain.typ, 19.642 + 0.716);
    near(a2.perChannel.find((c) => c.channel.id === "C60")!.gain.typ, 20.459 - 0.918);
  });
});

describe("T16b measured gain model", () => {
  it("Pin_total −12.5 (midpoint), setting 20: gain at 1528 = (20.6 + 19.9)/2 = 20.25", () => {
    const r = single("edfa-measured", { mode: "constant_gain", gain_dB: 20 }, -12.5, "grey-1528");
    const a = amp(r, "amp");
    expect(a.gainModel).toBe("measured");
    const g = a.perChannel[0].gain;
    near(g.typ, 20.25);
    // measurement_uncertainty_dB 0.3 applied to worst case: min 19.95, max 20.55
    near(g.min, 19.95);
    near(g.max, 20.55);
    expect(issues(r, "amp.spectrum_extrapolated")).toHaveLength(0);
    expect(a.operatingPoints).toContain("-20/-5");
  });
  it("at 1566 = (19.4 + 19.8)/2 = 19.6", () => {
    const a = amp(single("edfa-measured", { mode: "constant_gain", gain_dB: 20 }, -12.5, "grey-1566"), "amp");
    near(a.perChannel[0].gain.typ, 19.6);
  });
  it("setting 18 → each shifted by −2", () => {
    // nearest operating points: both at setting 20 (tie) → spectrum + (18 − 20)
    near(amp(single("edfa-measured", { mode: "constant_gain", gain_dB: 18 }, -12.5, "grey-1528"), "amp").perChannel[0].gain.typ, 18.25);
    near(amp(single("edfa-measured", { mode: "constant_gain", gain_dB: 18 }, -12.5, "grey-1566"), "amp").perChannel[0].gain.typ, 17.6);
  });
  it("Pin_total −25 → clamped to the −20 row + warning", () => {
    const r = single("edfa-measured", { mode: "constant_gain", gain_dB: 20 }, -25, "grey-1528");
    near(amp(r, "amp").perChannel[0].gain.typ, 20.6);
    const i = issues(r, "amp.spectrum_extrapolated", "amp");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("warn");
  });
  it("instance gain_model override parametric ignores the spectrum", () => {
    const a = amp(single("edfa-measured", { mode: "constant_gain", gain_dB: 20, gain_model: "parametric" }, -12.5, "grey-1528"), "amp");
    expect(a.gainModel).toBe("parametric");
    near(a.perChannel[0].gain.typ, 20);
  });
});

describe("T17 out-of-range input", () => {
  it("−35 dBm total, min −30 → error", () => {
    const r = single("edfa", { mode: "constant_gain", gain_dB: 20 }, -35);
    const i = issues(r, "amp.input_low", "amp");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("error");
    expect(amp(r, "amp").status).toBe("fail");
    // still computed: −35 + 20 = −15
    near(amp(r, "amp").poutTotal.typ, -15);
  });
});

// ---------------------------------------------------------------------------
// T18 — unbalanced channels → mux → EDFA → span → demux → Rx
// ---------------------------------------------------------------------------
/**
 * NOTE on the span: SPEC T18 uses a flat 0.20 dB/km ("80 km … = 16.0 dB"). With the G.652.D table the
 * attenuation at C21…C24 (1560.61…1558.17 nm) interpolates between 1550 (0.20) and 1625 (0.22) to
 * 0.2028…0.2022 dB/km, i.e. 16.23…16.17 dB. To reproduce the SPEC arithmetic the span carries the
 * instance override `attenuation_dB_per_km: 0.2` (SPEC 4.3); the table-based variant is tested separately.
 */
function t18(ampModel: string, settings: NodeSettings, spanOverride: number | null = 0.2) {
  const ch = ["C21", "C22", "C23", "C24"];
  const tx = [3, 0, -3, -6];
  return compute(
    project(
      [
        ...ch.map((c, i) => ({ id: `t${c}`, model: "dwdm-tunable", settings: { channel: c, tx_power_override_dBm: tx[i] } })),
        { id: "mux", model: "mux40-s" },
        { id: "amp", model: ampModel, settings },
        { id: "demux", model: "mux40-s" },
        ...ch.map((c) => ({ id: `r${c}`, model: "dwdm-tunable", settings: { channel: c } })),
      ],
      [
        ...ch.map((c) => ideal(`pt${c}`, `t${c}.tx`, `mux.${c}`)),
        ideal("pm", "mux.common", "amp.in"),
        // 80 km G.652.D with scalar LC (0.25 dB) at both ends: 16.0 + 0.5 = 16.5 dB
        fibre("span", "g652d", "amp.out", "demux.common", {
          length_km: 80,
          ja: "lc-s",
          jb: "lc-s",
          ...(spanOverride !== null ? { attenuation_dB_per_km: spanOverride } : {}),
        }),
        ...ch.map((c) => ideal(`pr${c}`, `demux.${c}`, `r${c}.rx`)),
      ],
      { system_margin_dB: 3, ageing_dB: 0, repair_splices: 0, connector_ageing_dB: 0 },
    ),
    catalog(),
  );
}
const rxOf = (r: ReturnType<typeof compute>, c: string) => sig(r, `t${c}.tx:${c}`);

describe("T18 the complex case", () => {
  const r = t18("edfa", { mode: "constant_gain", gain_dB: 20 });
  const a = amp(r, "amp");
  it("mux 3.0 dB → 0, −3, −6, −9; total 2.74 dBm", () => {
    expect(a.perChannel.map((c) => c.channel.id)).toEqual(["C21", "C22", "C23", "C24"]);
    [0, -3, -6, -9].forEach((v, i) => near(a.perChannel[i].pin.typ, v));
    // 10·log10(1 + 0.5012 + 0.2512 + 0.1259) = 10·log10(1.8783) = 2.74
    near(a.pinTotal.typ, 2.74);
  });
  it("EDFA constant gain 20, Pout_max 20 → saturates, G_eff 17.26 → 17.26, 14.26, 11.26, 8.26 dBm (Pout_total 20.0)", () => {
    near(a.gainEffective.typ, 17.26);
    [17.26, 14.26, 11.26, 8.26].forEach((v, i) => near(a.perChannel[i].pout.typ, v));
    near(a.poutTotal.typ, 20.0);
    expect(issues(r, "amp.output_saturated", "amp")).toHaveLength(1);
  });
  it("80 km + 2 × LC = 16.5 dB → 0.76, −2.24, −5.24, −8.24 at demux common", () => {
    const common = r.ports.find((p) => p.node === "demux" && p.port === "common")!;
    [0.76, -2.24, -5.24, -8.24].forEach((v, i) => near(common.in.channels[i].power.typ, v));
  });
  it("demux 3.0 → −2.24, −5.24, −8.24, −11.24 dBm at Rx", () => {
    // 17.26 − 16.5 − 3.0 = −2.24 etc.
    [-2.24, -5.24, -8.24, -11.24].forEach((v, i) => near(rxOf(r, ["C21", "C22", "C23", "C24"][i]).powerAtEnd.typ, v));
  });
  it("Rx sens −14, system margin 3 → C24 fails (−11.24 < −11), the rest pass", () => {
    expect(check(rxOf(r, "C24"), "rx.power_low").status).toBe("fail");
    // margin = −11.24 − 3 − (−14) = −0.24
    near(check(rxOf(r, "C24"), "rx.power_low").margin!, -0.24);
    for (const c of ["C21", "C22", "C23"]) expect(check(rxOf(r, c), "rx.power_low").status).toBe("pass");
  });
  it("imbalance in = out = 9 dB", () => {
    near(a.imbalanceIn_dB!, 9);
    near(a.imbalanceOut_dB!, 9);
    // 9 > max_channel_imbalance_dB 6 → imbalance issues at amp in, amp out, mux common, demux common
    expect(issues(r, "imbalance.high", "amp").map((i) => i.port).sort()).toEqual(["in", "out"]);
    expect(issues(r, "imbalance.high", "mux")).toHaveLength(1);
    expect(issues(r, "imbalance.high", "demux")).toHaveLength(1);
  });
  it("with gain_flatness_dB 1 worst case C24.min = −12.24", () => {
    const r2 = t18("edfa-flat1", { mode: "constant_gain", gain_dB: 20 });
    // −11.24 − 1 = −12.24 ; typ unchanged
    near(rxOf(r2, "C24").powerAtEnd.min, -12.24);
    near(rxOf(r2, "C24").powerAtEnd.typ, -11.24);
    near(rxOf(r2, "C24").powerAtEnd.max, -10.24);
  });
  it("flatness spreads per-channel values, not the regulated total (Pout_total stays 20.0, no fibre.power_high)", () => {
    const r2 = t18("edfa-flat1", { mode: "constant_gain", gain_dB: 20 });
    const a2 = amp(r2, "amp");
    // per channel: C21 pout {16.26, 17.26, 18.26} (±1 dB flatness)
    near(a2.perChannel[0].pout.min, 16.26);
    near(a2.perChannel[0].pout.max, 18.26);
    // total uses nominal per-channel gains: 20.0 in every case (saturated)
    near(a2.poutTotal.max, 20.0);
    const d = r2.fibres.find((f) => f.id === "span")!.directions[0];
    near(d.totalPower!.max, 20.0);
    // 20.0 ≤ 20 → margin 0: only the "tight margin" warning, no error
    expect(issues(r2, "fibre.power_high").map((i) => i.severity)).toEqual(["warn"]);
  });
  it("constant output power 20 dBm gives identical numbers", () => {
    const r2 = t18("edfa", { mode: "constant_output_power", output_power_dBm: 20 });
    // G = 20 − 2.74 = 17.26
    near(amp(r2, "amp").gainEffective.typ, 17.26);
    [-2.24, -5.24, -8.24, -11.24].forEach((v, i) => near(rxOf(r2, ["C21", "C22", "C23", "C24"][i]).powerAtEnd.typ, v));
    expect(check(rxOf(r2, "C24"), "rx.power_low").status).toBe("fail");
    expect(check(rxOf(r2, "C23"), "rx.power_low").status).toBe("pass");
  });
  it("constant output power 17 dBm → G 14.26 → Rx −5.24, −8.24, −11.24, −14.24; C23 and C24 fail", () => {
    const r2 = t18("edfa", { mode: "constant_output_power", output_power_dBm: 17 });
    // G = 17 − 2.74 = 14.26 ; Rx = pin + 14.26 − 16.5 − 3.0
    near(amp(r2, "amp").gainEffective.typ, 14.26);
    [-5.24, -8.24, -11.24, -14.24].forEach((v, i) => near(rxOf(r2, ["C21", "C22", "C23", "C24"][i]).powerAtEnd.typ, v));
    expect(check(rxOf(r2, "C21"), "rx.power_low").status).toBe("pass");
    expect(check(rxOf(r2, "C22"), "rx.power_low").status).toBe("pass");
    expect(check(rxOf(r2, "C23"), "rx.power_low").status).toBe("fail");
    expect(check(rxOf(r2, "C24"), "rx.power_low").status).toBe("fail");
  });
  it("with the G.652.D table instead of a flat 0.20 dB/km the conclusions are unchanged", () => {
    const r2 = t18("edfa", { mode: "constant_gain", gain_dB: 20 }, null);
    // C21 @1560.606 nm: 0.20 + 0.02 × 10.606/75 = 0.20283 dB/km × 80 = 16.226 + 0.5 = 16.726 → 17.263 − 16.726 − 3 = −2.46
    near(rxOf(r2, "C21").powerAtEnd.typ, -2.46);
    // C24 @1558.173 nm: 0.20218 × 80 = 16.174 + 0.5 = 16.674 → 8.263 − 16.674 − 3 = −11.41
    near(rxOf(r2, "C24").powerAtEnd.typ, -11.41);
    expect(check(rxOf(r2, "C24"), "rx.power_low").status).toBe("fail");
    for (const c of ["C21", "C22", "C23"]) expect(check(rxOf(r2, c), "rx.power_low").status).toBe("pass");
  });
  it("span launch = amp output 20.0 dBm ≤ 20 (at the limit → warn)", () => {
    const d = r.fibres.find((f) => f.id === "span")!.directions[0];
    near(d.totalPower!.typ, 20.0);
    expect(d.status).toBe("warn");
  });
});

describe("T19 cascaded amplifiers", () => {
  // amp2 is listed BEFORE amp1 so model order ≠ topological order.
  const m = project(
    [
      { id: "tx", model: "grey-1550", settings: { tx_power_override_dBm: -10 } },
      { id: "amp2", model: "edfa", settings: { mode: "constant_gain", gain_dB: 15 } },
      { id: "amp1", model: "edfa", settings: { mode: "constant_gain", gain_dB: 15 } },
      { id: "rx", model: "grey-1550" },
    ],
    [
      ideal("p1", "tx.tx", "amp1.in"),
      fibre("span1", "g652d", "amp1.out", "amp2.in", { length_km: 80, ja: "lc-s", jb: "lc-s" }),
      fibre("span2", "g652d", "amp2.out", "rx.rx", { length_km: 50, ja: "lc-s", jb: "lc-s" }),
    ],
  );
  const r = compute(m, catalog());
  it("topological ordering: amp1 before amp2", () => {
    expect(r.amplifiers.map((a) => a.id)).toEqual(["amp1", "amp2"]);
  });
  it("second amp's Pin_total derives from first amp's output", () => {
    // amp1: −10 + 15 = 5 ; span1: 80 × 0.2 + 2 × 0.25 = 16.5 → amp2 Pin = 5 − 16.5 = −11.5
    near(amp(r, "amp1").poutTotal.typ, 5);
    near(amp(r, "amp2").pinTotal.typ, -11.5);
    // amp2: −11.5 + 15 = 3.5 ; span2: 50 × 0.2 + 0.5 = 10.5 → Rx −7.0
    near(amp(r, "amp2").poutTotal.typ, 3.5);
    near(sig(r, "tx.tx:1550nm").powerAtEnd.typ, -7.0);
  });
});

describe("T20 amplified loop", () => {
  // tx C21 → m1.C21 → m1.common → amp → f → m2.common (no C21 port) → m2.express → m1.express → m1.common → … (ring)
  const ring = (withAmp: boolean) =>
    project(
      [
        { id: "tx", model: "dwdm-tunable", settings: { channel: "C21" } },
        { id: "m1", model: "oadm-c21-x" },
        ...(withAmp ? [{ id: "amp", model: "edfa", settings: { mode: "constant_gain" as const, gain_dB: 20 } }] : []),
        { id: "m2", model: "oadm-c30-x" },
      ],
      [
        ideal("pt", "tx.tx", "m1.C21"),
        ...(withAmp
          ? [ideal("pa", "m1.common", "amp.in"), fibre("f", "g652d", "amp.out", "m2.common", { length_km: 10, ja: "lc-s", jb: "lc-s" })]
          : [fibre("f", "g652d", "m1.common", "m2.common", { length_km: 10, ja: "lc-s", jb: "lc-s" })]),
        ideal("px", "m2.express", "m1.express"),
      ],
    );
  it("ring with an amp and no drop → error, no infinite loop", () => {
    const r = compute(ring(true), catalog());
    const i = issues(r, "topology.amplified_loop", "amp");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("error");
    const s = sig(r, "tx.tx:C21");
    expect(s.terminated).toBe("loop");
    expect(s.status).toBe("fail");
    expect(r.elementStatus.amp).toBe("fail");
  });
  it("passive ring → topology.loop error, powers still computed", () => {
    const r = compute(ring(false), catalog());
    expect(issues(r, "topology.loop")).toHaveLength(1);
    expect(issues(r, "topology.amplified_loop")).toHaveLength(0);
    const s = sig(r, "tx.tx:C21");
    expect(s.terminated).toBe("loop");
    expect(Number.isFinite(s.powerAtEnd.typ)).toBe(true);
  });
  it("amplifier dependency cycle across two signals (no single-signal loop) → amplified loop", () => {
    // Ring Add1 → A → Drop1 → Add2 → B → Drop2 → Add1. s1 (C21) passes A then B; s2 (C22) passes B then A.
    const m = project(
      [
        { id: "s1", model: "dwdm-tunable", settings: { channel: "C21" } },
        { id: "s2", model: "dwdm-tunable", settings: { channel: "C22" } },
        { id: "r1", model: "dwdm-tunable", settings: { channel: "C21" } },
        { id: "r2", model: "dwdm-tunable", settings: { channel: "C22" } },
        { id: "add1", model: "oadm-c21-x" },
        { id: "drop1", model: "oadm-c22-x" },
        { id: "add2", model: "oadm-c22-x" },
        { id: "drop2", model: "oadm-c21-x" },
        { id: "A", model: "edfa", settings: { mode: "constant_gain", gain_dB: 15 } },
        { id: "B", model: "edfa", settings: { mode: "constant_gain", gain_dB: 15 } },
      ],
      [
        ideal("a1", "s1.tx", "add1.C21"),
        ideal("a2", "s2.tx", "add2.C22"),
        ideal("d1", "drop1.C22", "r2.rx"),
        ideal("d2", "drop2.C21", "r1.rx"),
        ideal("l1", "add1.common", "A.in"),
        ideal("l2", "A.out", "drop1.common"),
        ideal("l3", "drop1.express", "add2.express"),
        ideal("l4", "add2.common", "B.in"),
        ideal("l5", "B.out", "drop2.common"),
        ideal("l6", "drop2.express", "add1.express"),
      ],
    );
    const r = compute(m, catalog());
    expect(issues(r, "topology.loop")).toHaveLength(0);
    expect(issues(r, "topology.amplified_loop").map((i) => i.element).sort()).toEqual(["A", "B"]);
    expect(sig(r, "s1.tx:C21").terminated).toBe("loop");
    expect(sig(r, "s2.tx:C22").terminated).toBe("loop");
    expect(r.amplifiers).toHaveLength(0);
  });
});

describe("direction", () => {
  it("a signal arriving at an amplifier's out port → topology.direction_conflict", () => {
    const r = compute(
      project(
        [
          { id: "tx", model: "grey-1550" },
          { id: "amp", model: "edfa", settings: { mode: "constant_gain", gain_dB: 20 } },
        ],
        [ideal("p", "tx.tx", "amp.out")],
      ),
      catalog(),
    );
    const i = issues(r, "topology.direction_conflict", "amp");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("error");
    expect(sig(r, "tx.tx:1550nm").status).toBe("fail");
  });
});
