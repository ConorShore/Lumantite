/** SPEC §12 "Mux / demux": T9–T12. */
import { describe, expect, it } from "vitest";
import { compute } from "../src/index.js";
import { catalog, check, fibre, issues, near, nearT, project, sig } from "./fixtures.js";

/** n tunable transceivers on the given channels, each through a 0-length LC/UPC patch into mux.<channel>. */
function txBank(channels: string[], powers: number[], txModel = "dwdm-tunable", mux = "mux") {
  const nodes = channels.map((ch, i) => ({ id: `t${ch.replace(".", "_")}`, model: txModel, settings: { channel: ch, tx_power_override_dBm: powers[i] } }));
  const fibres = channels.map((ch) => fibre(`p${ch.replace(".", "_")}`, "lc-patch", `t${ch.replace(".", "_")}.tx`, `${mux}.${ch}`, { length_km: 0 }));
  return { nodes, fibres };
}

describe("T9 equal channels", () => {
  // Tx 0.5 dBm − 2 × LC typ 0.25 = 0 dBm at each mux channel port
  const b = txBank(["C21", "C22", "C23", "C24"], [0.5, 0.5, 0.5, 0.5]);
  const r = compute(project([...b.nodes, { id: "mux", model: "mux40" }], b.fibres), catalog());
  const common = r.ports.find((p) => p.node === "mux" && p.port === "common")!;
  it("4 × 0 dBm into mux (3.0 dB): common = −3 + 10·log10(4) = 3.02 dBm", () => {
    expect(common.out.channels).toHaveLength(4);
    for (const c of common.out.channels) near(c.power.typ, -3.0);
    near(common.out.totalPower!.typ, 3.02);
  });
  it("channel port input is 0 dBm", () => {
    const p = r.ports.find((x) => x.node === "mux" && x.port === "C21")!;
    near(p.in.channels[0].power.typ, 0);
  });
  it("imbalance 0 → no imbalance issue", () => {
    expect(issues(r, "imbalance.high")).toHaveLength(0);
  });
});

describe("T10 unequal channels", () => {
  // Tx 3.5, 0.5, −2.5, −6.5 − 0.5 (patch LCs) − 3.0 (mux) → 0, −3, −6, −10 dBm at common
  const b = txBank(["C21", "C22", "C23", "C24"], [3.5, 0.5, -2.5, -6.5]);
  const r = compute(project([...b.nodes, { id: "mux", model: "mux40" }], b.fibres), catalog());
  const common = r.ports.find((p) => p.node === "mux" && p.port === "common")!;
  it("total = 10·log10(1 + 0.5012 + 0.2512 + 0.1) = 2.68 dBm", () => {
    expect(common.out.channels.map((c) => Math.round(c.power.typ * 100) / 100)).toEqual([0, -3, -6, -10]);
    near(common.out.totalPower!.typ, 2.68);
  });
  it("imbalance 10 dB → fails max_channel_imbalance_dB 6", () => {
    const i = issues(r, "imbalance.high", "mux");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("error");
    expect(i[0].port).toBe("common");
    // 0 − (−10) = 10 dB
    near(Number(i[0].values!.imbalance_dB), 10);
    expect(common.status).toBe("fail");
    expect(r.elementStatus.mux).toBe("fail");
  });
});

describe("T11 mux routing", () => {
  it("wrong wavelength on a channel port → error, blocked", () => {
    const m = project(
      [
        { id: "t25", model: "dwdm-tunable", settings: { channel: "C25" } },
        { id: "oadm", model: "oadm4" },
      ],
      [fibre("p", "lc-patch", "t25.tx", "oadm.C21", { length_km: 0 })],
    );
    const r = compute(m, catalog());
    const s = sig(r, "t25.tx:C25");
    expect(s.terminated).toBe("dropped");
    expect(check(s, "mux.wrong_channel").status).toBe("fail");
    const i = issues(r, "mux.wrong_channel", "oadm");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("error");
    // nothing leaves on common
    expect(r.ports.find((p) => p.node === "oadm" && p.port === "common")).toBeUndefined();
  });

  const atCommon = (muxModel: string, ch: string) =>
    compute(
      project(
        [
          { id: "t", model: "dwdm-tunable", settings: { channel: ch } },
          { id: "oadm", model: muxModel },
        ],
        [fibre("p", "lc-patch", "t.tx", "oadm.common", { length_km: 0 })],
      ),
      catalog(),
    );

  it("unmatched channel at common, no express port → dropped + warning", () => {
    const r = atCommon("oadm4", "C25");
    const s = sig(r, "t.tx:C25");
    expect(s.terminated).toBe("dropped");
    expect(check(s, "mux.channel_dropped").status).toBe("warn");
    const i = issues(r, "mux.channel_dropped", "oadm");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("warn");
  });

  it("unmatched channel at common with express port → routed with express loss", () => {
    const r = atCommon("oadm4-x", "C25");
    const s = sig(r, "t.tx:C25");
    const step = s.path.find((p) => p.element === "oadm")!;
    expect(step.inPort).toBe("common");
    expect(step.outPort).toBe("express");
    // express loss {typ 1.0, max 1.5} → min ← typ = 1.0 ; Δ = {−max, −typ, −min} = {−1.5, −1.0, −1.0}
    nearT(step.deltaPower, { min: -1.5, typ: -1.0, max: -1.0 });
    expect(issues(r, "mux.channel_dropped")).toHaveLength(0);
    // express is unconnected → the signal is unterminated (warning)
    expect(s.terminated).toBe("dead_end");
  });

  it("matched channel at common → leaves on its channel port with 3.0 dB", () => {
    const r = atCommon("oadm4", "C24");
    const step = sig(r, "t.tx:C24").path.find((p) => p.element === "oadm")!;
    expect(step.outPort).toBe("C24");
    near(step.deltaPower.typ, -3.0);
  });
});

describe("T12 fibre launch limit", () => {
  // 80 tunable Tx on the 50 GHz plan at 7.5 dBm; − 0.5 (patch LCs) − 3.0 (mux) = +4 dBm per channel at common
  const cat = catalog();
  const chans = cat.channels("dwdm-c-50ghz-80").map((c) => c.id);
  const b = txBank(chans, chans.map(() => 7.5), "dwdm80-tunable");
  const m = project(
    [...b.nodes, { id: "mux", model: "mux80" }, { id: "rx", model: "grey-1550" }],
    [...b.fibres, fibre("span", "g652d", "mux.common", "rx.rx", { length_km: 1, ja: "lc-upc", jb: "lc-upc" })],
  );
  const r = compute(m, cat);
  it("channel ports with dotted names (C21.5) resolve", () => {
    expect(chans).toHaveLength(80);
    expect(issues(r, "project.unknown_port")).toHaveLength(0);
    expect(sig(r, "tC21_5.tx:C21.5").path.some((p) => p.element === "mux" && p.inPort === "C21.5")).toBe(true);
  });
  it("80 × +4 dBm → 4 + 19.03 = 23.03 dBm > 20 → fail", () => {
    const d = r.fibres.find((f) => f.id === "span")!.directions.find((x) => x.direction === "a>b")!;
    expect(d.channels).toHaveLength(80);
    near(d.channels[0].power.typ, 4.0);
    // 10·log10(80) = 19.03
    near(d.totalPower!.typ, 23.03);
    expect(d.status).toBe("fail");
    const i = issues(r, "fibre.power_high", "span");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("error");
    expect(r.elementStatus.span).toBe("fail");
  });
});
