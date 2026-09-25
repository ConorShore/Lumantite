/** SPEC §12 "Simple": T1–T8. */
import { describe, expect, it } from "vitest";
import { compute } from "../src/index.js";
import { catalog, check, fibre, issues, near, nearT, project, PSNM, sig } from "./fixtures.js";

const pointToPoint = (txModel: string, km: number, opts: { override?: number; margins?: Parameters<typeof project>[2] } = {}) =>
  project(
    [
      { id: "tx", model: txModel, ...(opts.override !== undefined ? { settings: { tx_power_override_dBm: opts.override } } : {}) },
      { id: "rx", model: "grey-1550" },
    ],
    [fibre("f1", "g652d", "tx.tx", "rx.rx", { length_km: km, ja: "lc-upc", jb: "lc-upc" })],
    opts.margins,
  );

describe("T1 single span, 1550 nm", () => {
  const r = compute(pointToPoint("grey-1550", 10, { override: 0 }), catalog());
  const s = sig(r, "tx.tx:1550nm");
  it("reaches the receiver", () => {
    expect(s.terminated).toBe("rx");
    expect(s.rx).toEqual({ node: "rx", port: "rx" });
  });
  it("power = 0 − 2.0 − 0.5 = −2.5 dBm (typ)", () => {
    // fibre 10 km × 0.20 dB/km = 2.0 dB; two LC/UPC joints × 0.25 dB = 0.5 dB
    near(s.powerAtEnd.typ, -2.5);
  });
  it("CD = 17.46 × 10 = 174.6 ps/nm", () => {
    near(s.cdAtEnd, 174.6, PSNM);
  });
  it("path: Tx, port joint, fibre, port joint, Rx", () => {
    expect(s.path.map((p) => p.element)).toEqual(["tx", "joint:tx.tx~f1.a", "f1", "joint:rx.rx~f1.b", "rx"]);
    // fibre step Δ typ = −2.0; joint Δ typ = −0.25
    near(s.path[2].deltaPower.typ, -2.0);
    near(s.path[1].deltaPower.typ, -0.25);
    near(s.path[2].deltaCd, 174.6, PSNM);
  });
  it("fibre result: loss at 1550 = 2.0, a>b launch 0 dBm", () => {
    const f = r.fibres.find((x) => x.id === "f1")!;
    near(f.loss.typ, 2.0);
    expect(f.directions.map((d) => d.direction)).toEqual(["a>b"]);
    near(f.directions[0].totalPower!.typ, 0);
  });
  it("ports: tx out 0 dBm, rx in −2.5 dBm", () => {
    const tx = r.ports.find((p) => p.node === "tx" && p.port === "tx")!;
    const rx = r.ports.find((p) => p.node === "rx" && p.port === "rx")!;
    near(tx.out.channels[0].power.typ, 0);
    near(rx.in.channels[0].power.typ, -2.5);
    near(rx.in.totalPower!.typ, -2.5);
  });
});

describe("T2 same at 1310 nm", () => {
  const r = compute(pointToPoint("grey-1310", 10, { override: 0 }), catalog());
  const s = sig(r, "tx.tx:1310nm");
  it("loss 3.5 + 0.5 = 4.0 dB", () => {
    // 10 km × 0.35 dB/km = 3.5; 2 × 0.25 = 0.5
    near(s.powerAtEnd.typ, -4.0);
  });
  it("CD = 0 (λ = λ0)", () => {
    near(s.cdAtEnd, 0, PSNM);
  });
});

describe("T3 spliced sections", () => {
  // 30 + 20 + 10 km with two fusion splices, LC at both device ends
  const m = project(
    [
      { id: "tx", model: "grey-1550" },
      { id: "rx", model: "grey-1550" },
    ],
    [
      fibre("s1", "g652d", "tx.tx", "s2.a", { length_km: 30, ja: "lc-upc" }),
      fibre("s2", "g652d", "s1.b", "s3.a", { length_km: 20 }),
      fibre("s3", "g652d", "s2.b", "rx.rx", { length_km: 10, jb: "lc-upc" }),
    ],
  );
  const r = compute(m, catalog());
  const s = sig(r, "tx.tx:1550nm");
  it("loss = 12.0 + 0.1 + 0.5 = 12.6 dB", () => {
    // 60 km × 0.2 = 12.0; 2 fusion splices × 0.05 = 0.1; 2 LC × 0.25 = 0.5
    near(s.powerAtEnd.typ, -12.6);
  });
  it("each fibre-end pair yields ONE splice", () => {
    const joints = s.path.filter((p) => p.kind === "joint").map((p) => p.element);
    expect(joints).toEqual(["joint:tx.tx~s1.a", "joint:s1.b~s2.a", "joint:s2.b~s3.a", "joint:rx.rx~s3.b"]);
  });
  it("no validation issues", () => {
    expect(issues(r, "project.endpoint_asymmetric")).toHaveLength(0);
    expect(issues(r, "project.joint_family_mismatch")).toHaveLength(0);
  });
});

describe("T4 CWDM interpolation", () => {
  const m = project(
    [
      { id: "tx", model: "cwdm-1471" },
      { id: "rx", model: "grey-1550" },
    ],
    [fibre("f1", "g652d", "tx.tx", "rx.rx", { length_km: 10, ja: "lc-upc", jb: "lc-upc" })],
  );
  const r = compute(m, catalog());
  const s = sig(r, "tx.tx:1471");
  it("fibre loss at 1471 nm = 0.2595 dB/km × 10 km = 2.595 dB", () => {
    // 0.35 − 0.11 × 88/107 = 0.25953 dB/km
    const f = s.path.find((p) => p.element === "f1")!;
    near(-f.deltaPower.typ, 2.595);
    // end power 0 − 2.595 − 0.5 = −3.095
    near(s.powerAtEnd.typ, -3.095);
  });
  it("channel is the CWDM plan channel", () => {
    expect(s.channel.plan).toBe("cwdm-18");
    near(s.channel.wavelength_nm, 1471, 1e-9);
  });
});

describe("T5 min/typ/max bracket", () => {
  const r = compute(pointToPoint("grey-1550-t5", 10), catalog());
  it("Tx {0,2,4}, LC {0.1,0.25,0.5} ×2, 10 km → Rx {−3.0, −0.5, 1.8}", () => {
    // min = 0 − 2.0 − 2×0.5 = −3.0 ; typ = 2 − 2.0 − 2×0.25 = −0.5 ; max = 4 − 2.0 − 2×0.1 = 1.8
    nearT(sig(r, "tx.tx:1550nm").powerAtEnd, { min: -3.0, typ: -0.5, max: 1.8 });
  });
});

describe("T6 Rx overload", () => {
  const m = project(
    [
      { id: "tx", model: "grey-1550-t5" },
      { id: "rx", model: "grey-1550" },
    ],
    // lc-patch: default 2 m, default joint lc-upc
    [{ id: "p1", type: "lc-patch", a: { to: "tx.tx" }, b: { to: "rx.rx" } }],
  );
  const r = compute(m, catalog());
  const s = sig(r, "tx.tx:1550nm");
  it("P.max = 4 − 2×0.1 − 0.002×0.2 = 3.7996 dBm > −7 → fail high", () => {
    near(s.powerAtEnd.max, 3.7996, 1e-3);
    const c = check(s, "rx.power_high");
    expect(c.status).toBe("fail");
    // margin = −7 − 3.7996 = −10.7996
    near(c.margin!, -10.7996, 1e-3);
    expect(s.status).toBe("fail");
    expect(issues(r, "rx.power_high", "rx")[0].severity).toBe("error");
    expect(r.elementStatus.rx).toBe("fail");
  });
});

describe("T7 CD tolerance (10G SFP, ±1600 ps/nm)", () => {
  const noMargin = { cd_margin_pct: 0 };
  it("80 km → 1396.8 ps/nm pass", () => {
    const r = compute(pointToPoint("grey-1550", 80, { margins: noMargin }), catalog());
    const s = sig(r, "tx.tx:1550nm");
    // 17.4605 × 80 = 1396.84
    near(s.cdAtEnd, 1396.8, PSNM);
    expect(check(s, "rx.cd").status).toBe("pass");
  });
  it("80 km with cd_margin_pct 10: 1396.8 × 1.1 = 1536.5 still pass", () => {
    const r = compute(pointToPoint("grey-1550", 80, { margins: { cd_margin_pct: 10 } }), catalog());
    const c = check(sig(r, "tx.tx:1550nm"), "rx.cd");
    near(Number(c.values!.cd_with_margin), 1536.5, PSNM);
    expect(c.status).toBe("pass");
    // margin 1600 − 1536.5 = 63.5
    near(c.margin!, 63.5, PSNM);
  });
  it("100 km → 1746 ps/nm fail", () => {
    const r = compute(pointToPoint("grey-1550", 100, { margins: noMargin }), catalog());
    const s = sig(r, "tx.tx:1550nm");
    // 17.4605 × 100 = 1746.05
    near(s.cdAtEnd, 1746.0, PSNM);
    expect(check(s, "rx.cd").status).toBe("fail");
    expect(issues(r, "rx.cd", "rx")).toHaveLength(1);
  });
  it("100 km + DCM −800 → 946 ps/nm pass", () => {
    const m = project(
      [
        { id: "tx", model: "grey-1550" },
        { id: "dcm", model: "dcm-800" },
        { id: "rx", model: "grey-1550" },
      ],
      [
        fibre("f1", "g652d", "tx.tx", "dcm.in", { length_km: 100, ja: "lc-upc", jb: "lc-upc" }),
        fibre("p1", "lc-patch", "dcm.out", "rx.rx", { length_km: 0 }),
      ],
    );
    const r = compute(m, catalog());
    const s = sig(r, "tx.tx:1550nm");
    // 1746.05 − 800 = 946.05
    near(s.cdAtEnd, 946.0, PSNM);
    const c = check(s, "rx.cd");
    expect(c.status).toBe("pass");
    // default cd_margin_pct 10: 946.05 × 1.1 = 1040.66
    near(Number(c.values!.cd_with_margin), 1040.7, PSNM);
    const d = s.path.find((p) => p.element === "dcm")!;
    near(d.deltaCd, -800, PSNM);
  });
});

describe("T8 margins", () => {
  // Tx −17 dBm (scalar), 10 km (2.0 dB), 2 × LC max 0.5 → P.min = −17 − 2.0 − 1.0 = −20.0
  const base = { system_margin_dB: 3, ageing_dB: 1, repair_splices: 2, repair_splice_loss_dB: 0.1, connector_ageing_dB: 0 };
  it("P.min = −20.0 dBm", () => {
    const r = compute(pointToPoint("grey-1550", 10, { override: -17, margins: base }), catalog());
    near(sig(r, "tx.tx:1550nm").powerAtEnd.min, -20.0);
  });
  it("system 3 + ageing 1 + 2×0.1 = 4.2 → −24.2 < −24 → fail", () => {
    const r = compute(pointToPoint("grey-1550", 10, { override: -17, margins: base }), catalog());
    const c = check(sig(r, "tx.tx:1550nm"), "rx.power_low");
    near(Number(c.values!.penalty_dB), 4.2);
    // margin = −20 − 4.2 − (−24) = −0.2
    near(c.margin!, -0.2);
    expect(c.status).toBe("fail");
  });
  it("ageing 0.5 → −23.7 ≥ −24 → pass (margin 0.3; 'warn' under the default 1.0 dB warn threshold)", () => {
    const m = pointToPoint("grey-1550", 10, { override: -17, margins: { ...base, ageing_dB: 0.5 } });
    const c = check(sig(compute(m, catalog()), "tx.tx:1550nm"), "rx.power_low");
    // margin = −20 − 3.7 + 24 = +0.3
    near(c.margin!, 0.3);
    expect(c.status).toBe("warn");
    const c2 = check(sig(compute(m, catalog(), { warnThreshold_dB: 0.2 }), "tx.tx:1550nm"), "rx.power_low");
    expect(c2.status).toBe("pass");
  });
  it("connector_ageing × n_connectors (2 LC joints)", () => {
    const m = pointToPoint("grey-1550", 10, { override: -17, margins: { ...base, ageing_dB: 0.5, connector_ageing_dB: 0.1 } });
    const c = check(sig(compute(m, catalog()), "tx.tx:1550nm"), "rx.power_low");
    expect(c.values!.n_connectors).toBe(2);
    // penalty = 3 + 0.5 + 0.2 + 0.1×2 = 3.9 → margin = −20 − 3.9 + 24 = 0.1
    near(c.margin!, 0.1);
  });
  it("precedence: project.margins > opts.defaultMargins > DEFAULT_MARGINS", () => {
    // defaults only: ageing 0.5 from opts, rest from DEFAULT_MARGINS (3, 2×0.1, 0) → penalty 3.7 → margin 0.3
    const noProj = pointToPoint("grey-1550", 10, { override: -17 });
    const c1 = check(sig(compute(noProj, catalog(), { defaultMargins: { ageing_dB: 0.5 } }), "tx.tx:1550nm"), "rx.power_low");
    near(c1.margin!, 0.3);
    // project ageing 1 overrides opts 0.5 → penalty 4.2 → margin −0.2
    const proj = pointToPoint("grey-1550", 10, { override: -17, margins: { ageing_dB: 1 } });
    const c2 = check(sig(compute(proj, catalog(), { defaultMargins: { ageing_dB: 0.5 } }), "tx.tx:1550nm"), "rx.power_low");
    near(c2.margin!, -0.2);
    // nothing given: DEFAULT_MARGINS (3 + 1 + 0.2) → −0.2
    const c3 = check(sig(compute(noProj, catalog()), "tx.tx:1550nm"), "rx.power_low");
    near(c3.margin!, -0.2);
  });
});
