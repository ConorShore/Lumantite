/**
 * SPEC §12 "Reference numbers from the optical networking tutorial": T44. Golden numbers from
 * the conference talk "Everything You Always Wanted to Know About Optical Networking", checked
 * against existing engine behaviour only (no new rules). Latency is out of scope (SPEC 7.10
 * intro) and not covered here.
 */
import { describe, expect, it } from "vitest";
import { compute, dbmToMw, mwToDbm, resolveCatalog } from "../src/index.js";
import { CATALOG_ENTRIES, catalog, check, fibre, ideal, issues, near, project, sig } from "./fixtures.js";

function localCatalog(extra: unknown[]) {
  const r = resolveCatalog([...CATALOG_ENTRIES, ...extra]);
  if (r.issues.length) throw new Error("local test catalog invalid: " + JSON.stringify(r.issues));
  return r.catalog;
}

/** 40 DWDM channels (C21..C60), each a tunable Tx at `powerDbm`, wired lossless into `muxId`. */
function channelBank(powerDbm: number, muxId = "mux40-lossless") {
  const channels = Array.from({ length: 40 }, (_, i) => `C${21 + i}`);
  const nodes = channels.map((ch) => ({ id: `t${ch}`, model: "dwdm-tunable", settings: { channel: ch, tx_power_override_dBm: powerDbm } }));
  const fibres = channels.map((ch) => ideal(`p${ch}`, `t${ch}.tx`, `${muxId}.${ch}`));
  return { channels, nodes, fibres };
}

describe("T44 golden cases", () => {
  it("40 x 0 dBm channels combine to +16.02 dBm (10*log10(40))", () => {
    const cat = localCatalog([{ kind: "mux", id: "mux40-lossless", extends: "mux40", insertion_loss_dB: 0 }]);
    const b = channelBank(0);
    const r = compute(project([...b.nodes, { id: "mux40-lossless", model: "mux40-lossless" }], b.fibres), cat);
    const common = r.ports.find((p) => p.node === "mux40-lossless" && p.port === "common")!;
    expect(common.out.channels).toHaveLength(40);
    // 10*log10(40) = 16.0206
    near(common.out.totalPower!.typ, 16.02, 0.01);
  });

  describe("amp with input_power_total_dBm.max = -6 dBm over 40 channels", () => {
    // Boundary: 40 equal channels combine with +10*log10(40) = +16.02 dB; to keep the aggregate
    // at -6 dBm each channel must be at -6 - 16.02 = -22.02 dBm.
    const cat = localCatalog([
      { kind: "mux", id: "mux40-lossless", extends: "mux40", insertion_loss_dB: 0 },
      {
        kind: "amplifier",
        id: "amp-in6",
        band_nm: [1528, 1566],
        modes: ["constant_gain"],
        gain_dB: { min: 0, max: 0 },
        input_power_total_dBm: { min: -60, max: -6 },
        output_power_total_dBm: { max: 20 },
        connector: "lc-upc",
      },
    ]);
    const withAmp = (perChannelDbm: number) => {
      const b = channelBank(perChannelDbm);
      return compute(
        project(
          [...b.nodes, { id: "mux40-lossless", model: "mux40-lossless" }, { id: "amp", model: "amp-in6", settings: { mode: "constant_gain", gain_dB: 0 } }],
          [...b.fibres, ideal("pm", "mux40-lossless.common", "amp.in")],
        ),
        cat,
      );
    };
    it("each channel at -25 dBm (<= -22.02) -> aggregate -8.98 dBm, no amp.input_high", () => {
      const r = withAmp(-25);
      // 10*log10(40 * 10^(-25/10)) = -25 + 16.02 = -8.98
      expect(issues(r, "amp.input_high", "amp")).toHaveLength(0);
    });
    it("each channel at -21.5 dBm (> -22.02) -> aggregate -5.48 dBm, amp.input_high fails", () => {
      const r = withAmp(-21.5);
      // -21.5 + 16.02 = -5.48 > -6 dBm max
      const i = issues(r, "amp.input_high", "amp");
      expect(i).toHaveLength(1);
      expect(i[0].severity).toBe("error");
      near(Number(i[0].values!.pin_total_max), -5.48, 0.01);
    });
  });

  it("constant-output-power amp at +17 dBm over 40 balanced channels -> +0.98 dBm/channel", () => {
    // Balanced channels share the output equally: 17 - 10*log10(40) = 17 - 16.0206 = 0.9794 dBm.
    const cat = localCatalog([{ kind: "mux", id: "mux40-lossless", extends: "mux40", insertion_loss_dB: 0 }]);
    const b = channelBank(-20);
    const r = compute(
      project(
        [...b.nodes, { id: "mux40-lossless", model: "mux40-lossless" }, { id: "amp", model: "edfa", settings: { mode: "constant_output_power", output_power_dBm: 17 } }],
        [...b.fibres, ideal("pm", "mux40-lossless.common", "amp.in")],
      ),
      cat,
    );
    const a = r.amplifiers.find((x) => x.id === "amp")!;
    near(a.poutTotal.typ, 17);
    for (const c of a.perChannel) near(c.pout.typ, 0.98, 0.01);
    expect(issues(r, "amp.gain_clamped", "amp")).toHaveLength(0);
  });

  it("G.652.D 80 km at 1550 nm = 1396.8 ps/nm", () => {
    // D(1550) = 0.023 x (1550 - 1310^4/1550^3) = 17.4605 ps/(nm.km); x 80 km = 1396.84
    const m = project(
      [
        { id: "tx", model: "grey-1550" },
        { id: "rx", model: "grey-1550" },
      ],
      [fibre("f1", "g652d", "tx.tx", "rx.rx", { length_km: 80, ja: "lc-ideal", jb: "lc-ideal" })],
    );
    const r = compute(m, catalog());
    near(sig(r, "tx.tx:1550nm").cdAtEnd, 1396.8, 0.1);
  });

  it("50/50 splitter = 3.01 dB (+ excess)", () => {
    const m = project(
      [
        { id: "tx", model: "grey-1550" },
        { id: "sp", model: "split-50" },
        { id: "r1", model: "grey-1550" },
        { id: "r2", model: "grey-1550" },
      ],
      [ideal("p0", "tx.tx", "sp.in"), ideal("p1", "sp.out1", "r1.rx"), ideal("p2", "sp.out2", "r2.rx")],
    );
    const r = compute(m, catalog());
    // 10*log10(100/50) = 3.0103 dB, no excess loss on this fixture splitter
    const s1 = r.signals.find((x) => x.rx?.node === "r1")!;
    near(-s1.powerAtEnd.typ, 3.01, 0.01);

    // with 0.2 dB excess: 3.0103 + 0.2 = 3.21 (out2 left unrouted - only out1's number matters here)
    const cat = localCatalog([{ kind: "splitter", id: "split-50-ex", ratio: [50, 50], excess_loss_dB: 0.2, connector: "lc-upc" }]);
    const m2 = project(
      [
        { id: "tx", model: "grey-1550" },
        { id: "sp", model: "split-50-ex" },
        { id: "r1", model: "grey-1550" },
      ],
      [ideal("p0", "tx.tx", "sp.in"), ideal("p1", "sp.out1", "r1.rx")],
    );
    const r2 = compute(m2, cat);
    const s2 = r2.signals.find((x) => x.rx?.node === "r1")!;
    near(-s2.powerAtEnd.typ, 3.21, 0.01);
  });

  it("40 km optic (Tx max +2, overload -3) back to back -> rx.power_high", () => {
    const optic40 = {
      kind: "transceiver",
      id: "optic-40km",
      extends: "grey-1550",
      reach_km: 40,
      tx: { power_dBm: { min: -2, typ: 0, max: 2 } },
      rx: { sensitivity_dBm: -24, overload_dBm: -3, wavelength_range_nm: [1260, 1620] },
    };
    const cat = localCatalog([optic40]);
    const m = project(
      [
        { id: "tx", model: "optic-40km" },
        { id: "rx", model: "optic-40km" },
      ],
      [ideal("p1", "tx.tx", "rx.rx")],
    );
    const r = compute(m, cat);
    const s = sig(r, "tx.tx:1550nm");
    // back to back (lossless): P.max = +2 dBm > overload -3 dBm
    near(s.powerAtEnd.max, 2);
    expect(check(s, "rx.power_high").status).toBe("fail");
    expect(issues(r, "rx.power_high", "rx")).toHaveLength(1);
  });

  it("10 km-rated transceiver over 11 km with a passing budget: reach is informational only", () => {
    const optic10 = {
      kind: "transceiver",
      id: "optic-10km-generous",
      extends: "grey-1550",
      reach_km: 10,
      rx: { sensitivity_dBm: -30, overload_dBm: 10, wavelength_range_nm: [1260, 1620] },
    };
    const cat = localCatalog([optic10]);
    const m = project(
      [
        { id: "tx", model: "optic-10km-generous" },
        { id: "rx", model: "optic-10km-generous" },
      ],
      [fibre("f1", "g652d", "tx.tx", "rx.rx", { length_km: 11, ja: "lc-upc", jb: "lc-upc" })],
    );
    const r = compute(m, cat);
    const s = sig(r, "tx.tx:1550nm");
    // 11 km x 0.20 dB/km + 2 x 0.25 LC = 2.7 dB loss: 0 - 2.7 = -2.7 dBm, well within -30..10
    near(s.powerAtEnd.typ, -2.7);
    const i = issues(r, "rx.reach", "rx");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("info");
    near(Number(i[0].values!.path_km), 11);
    near(Number(i[0].values!.reach_km), 10);
    // no warn/fail anywhere on the signal: reach never fails or warns a link (SPEC 7.10 R11)
    expect(s.status).toBe("pass");
    for (const c of s.checks) expect(["pass", "n/a"]).toContain(c.status);
  });

  it("dB <-> mW sanity: 0 dBm = 1 mW, +3 ~ 2 mW, -3 ~ 0.5 mW, -10 dB = 1/10", () => {
    near(dbmToMw(0), 1, 1e-9);
    near(dbmToMw(3), 2, 0.01);
    near(dbmToMw(-3), 0.5, 0.01);
    // a -10 dB loss scales linear power by 10^(-10/10) = 1/10
    near(dbmToMw(-10) / dbmToMw(0), 0.1, 1e-9);
    near(mwToDbm(1), 0, 1e-9);
  });
});
