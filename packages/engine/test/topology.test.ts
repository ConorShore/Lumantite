/** SPEC §12 "Topology and format": T21–T23, plus static validation (SPEC 4.4, 6 rules). */
import { describe, expect, it } from "vitest";
import { compute, validate } from "../src/index.js";
import { catalog, check, fibre, ideal, issues, near, project, sig } from "./fixtures.js";

describe("T21 BiDi transceiver pair on one fibre", () => {
  const m = project(
    [
      { id: "A", model: "bidi-1310" },
      { id: "B", model: "bidi-1490", settings: { tx_power_override_dBm: 1 } },
    ],
    [fibre("f", "g652d", "A.bidi", "B.bidi", { length_km: 10, ja: "lc-upc", jb: "lc-upc" })],
  );
  const r = compute(m, catalog());
  it("two signals, opposite directions, different λ", () => {
    expect(r.signals.map((s) => s.id).sort()).toEqual(["A.bidi:1310nm", "B.bidi:1490nm"]);
    const ab = sig(r, "A.bidi:1310nm");
    const ba = sig(r, "B.bidi:1490nm");
    expect(ab.rx).toEqual({ node: "B", port: "bidi" });
    expect(ba.rx).toEqual({ node: "A", port: "bidi" });
    expect(ab.path.find((p) => p.element === "f")!.inPort).toBe("a");
    expect(ba.path.find((p) => p.element === "f")!.inPort).toBe("b");
  });
  it("each evaluated independently", () => {
    // A→B at 1310: 0 − 10 × 0.35 − 2 × 0.25 = −4.0
    near(sig(r, "A.bidi:1310nm").powerAtEnd.typ, -4.0);
    // B→A at 1490: 1 − 10 × 0.24 − 2 × 0.25 = −1.9
    near(sig(r, "B.bidi:1490nm").powerAtEnd.typ, -1.9);
    expect(check(sig(r, "A.bidi:1310nm"), "rx.wavelength").status).toBe("pass");
    expect(check(sig(r, "B.bidi:1490nm"), "rx.wavelength").status).toBe("pass");
    expect(issues(r, "topology.rx_no_signal")).toHaveLength(0);
    expect(issues(r, "topology.unterminated_tx")).toHaveLength(0);
  });
  it("fibre aggregate power reported per direction", () => {
    const f = r.fibres.find((x) => x.id === "f")!;
    const ab = f.directions.find((d) => d.direction === "a>b")!;
    const ba = f.directions.find((d) => d.direction === "b>a")!;
    near(ab.totalPower!.typ, 0);
    near(ba.totalPower!.typ, 1);
    expect(ab.channels.map((c) => c.channel.id)).toEqual(["1310nm"]);
    expect(ba.channels.map((c) => c.channel.id)).toEqual(["1490nm"]);
  });
  it("bidi port carries both directions in the port result", () => {
    const p = r.ports.find((x) => x.node === "A" && x.port === "bidi")!;
    expect(p.out.channels.map((c) => c.channel.id)).toEqual(["1310nm"]);
    expect(p.in.channels.map((c) => c.channel.id)).toEqual(["1490nm"]);
  });
  it("same-λ BiDi pair → rx.wavelength fails", () => {
    const r2 = compute(
      project(
        [
          { id: "A", model: "bidi-1310" },
          { id: "B", model: "bidi-1310" },
        ],
        [fibre("f", "g652d", "A.bidi", "B.bidi", { length_km: 1, ja: "lc-upc", jb: "lc-upc" })],
      ),
      catalog(),
    );
    expect(check(sig(r2, "A.bidi:1310nm"), "rx.wavelength").status).toBe("fail");
    expect(issues(r2, "rx.wavelength")).toHaveLength(2);
  });
});

describe("T22 connector family mismatch", () => {
  const m = project(
    [
      { id: "tx", model: "grey-1550" },
      { id: "rx", model: "grey-1550" },
    ],
    [fibre("f", "g652d", "tx.tx", "rx.rx", { length_km: 1, ja: "sc-upc", jb: "lc-upc" })],
  );
  it("SC end into LC port → error (validate and compute)", () => {
    const v = issues(validate(m, catalog()), "project.joint_family_mismatch");
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ severity: "error", element: "f", port: "a" });
    expect(issues(compute(m, catalog()), "project.joint_family_mismatch")).toHaveLength(1);
  });
  it("fibre-to-fibre ends with different joint models → error", () => {
    const m2 = project(
      [
        { id: "tx", model: "grey-1550" },
        { id: "rx", model: "grey-1550" },
      ],
      [
        fibre("f1", "g652d", "tx.tx", "f2.a", { length_km: 1, ja: "lc-upc", jb: "fusion-splice" }),
        fibre("f2", "g652d", "f1.b", "rx.rx", { length_km: 1, ja: "lc-upc", jb: "lc-upc" }),
      ],
    );
    expect(issues(validate(m2, catalog()), "project.joint_family_mismatch")).toHaveLength(1);
  });
});

describe("T23 unterminated Tx and Rx with no signal", () => {
  const r = compute(
    project(
      [
        { id: "lonelyTx", model: "grey-1550" },
        { id: "lonelyRx", model: "grey-1550" },
      ],
      [],
    ),
    catalog(),
  );
  it("unterminated Tx → warning", () => {
    const i = issues(r, "topology.unterminated_tx", "lonelyTx");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("warn");
    const s = sig(r, "lonelyTx.tx:1550nm");
    expect(s.terminated).toBe("dead_end");
    expect(s.status).toBe("warn");
  });
  it("Rx with no signal → warning", () => {
    const i = issues(r, "topology.rx_no_signal", "lonelyRx");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("warn");
    expect(i[0].port).toBe("rx");
  });
  it("Tx connected to a fibre that ends nowhere → unterminated", () => {
    const r2 = compute(project([{ id: "tx", model: "grey-1550" }], [{ id: "f", type: "g652d", length_km: 1, a: { to: "tx.tx", joint: "lc-upc" }, b: {} }]), catalog());
    const s = sig(r2, "tx.tx:1550nm");
    expect(s.terminated).toBe("dead_end");
    expect(s.path.map((p) => p.element)).toEqual(["tx", "joint:tx.tx~f.a", "f"]);
    expect(issues(r2, "topology.unterminated_tx", "tx")).toHaveLength(1);
  });
});

describe("static validation", () => {
  const cat = catalog();
  it("unknown model, unknown fibre type", () => {
    const v = validate(project([{ id: "x", model: "nope" }], [{ id: "f", type: "nope-fibre", length_km: 1 }]), cat);
    expect(issues(v, "catalog.unknown_model").map((i) => i.element).sort()).toEqual(["f", "x"]);
  });
  it("unknown endpoint and unknown port", () => {
    const v = validate(
      project([{ id: "tx", model: "grey-1550" }], [fibre("f", "lc-patch", "tx.nope", "ghost.rx")]),
      cat,
    );
    expect(issues(v, "project.unknown_port")).toHaveLength(1);
    expect(issues(v, "project.unknown_endpoint")).toHaveLength(1);
  });
  it("asymmetric fibre-to-fibre reference", () => {
    const v = validate(
      project(
        [{ id: "tx", model: "grey-1550" }],
        [fibre("f1", "g652d", "tx.tx", "f2.a", { length_km: 1, ja: "lc-upc" }), { id: "f2", type: "g652d", length_km: 1 }],
      ),
      cat,
    );
    expect(issues(v, "project.endpoint_asymmetric")).toHaveLength(1);
  });
  it("port used twice", () => {
    const v = validate(
      project(
        [
          { id: "tx", model: "grey-1550" },
          { id: "rx", model: "grey-1550" },
        ],
        [fibre("f1", "lc-patch", "tx.tx", "rx.rx"), fibre("f2", "lc-patch", "tx.tx", "rx.tx")],
      ),
      cat,
    );
    expect(issues(v, "project.endpoint_reused")).toHaveLength(1);
  });
  it("duplicate ids across nodes and fibres", () => {
    const v = validate(project([{ id: "x", model: "grey-1550" }], [{ id: "x", type: "lc-patch" }]), cat);
    expect(issues(v, "project.duplicate_id")).toHaveLength(1);
  });
  it("tunable transceiver without a channel; unsupported amp mode; missing gain", () => {
    const v = validate(
      project(
        [
          { id: "t", model: "dwdm-tunable" },
          { id: "a", model: "edfa", settings: { mode: "constant_gain" } },
        ],
        [],
      ),
      cat,
    );
    expect(issues(v, "project.invalid_settings").map((i) => i.element).sort()).toEqual(["a", "t"]);
    const v2 = validate(project([{ id: "a", model: "edfa", settings: { mode: "bogus" as never, gain_dB: 20 } }], []), cat);
    expect(issues(v2, "amp.mode_unsupported")).toHaveLength(1);
  });
  it("unknown site and host", () => {
    const v = validate(project([{ id: "t", model: "grey-1550", site: "nowhere", host: "nohost" }], []), cat);
    expect(issues(v, "project.unknown_site")).toHaveLength(1);
    expect(issues(v, "project.unknown_host")).toHaveLength(1);
  });
  it("compute never throws on bad input", () => {
    const r = compute({ rootFile: "x", files: [], project: { name: "x" }, sites: [], nodes: [{ id: "a", model: "nope", file: "x" }], fibres: [], layout: {} }, cat);
    expect(r.summary.errors).toBeGreaterThan(0);
  });
});

describe("routing details", () => {
  it("duplicate channel on one fibre in one direction → error", () => {
    // two C21 transmitters combined through a splitter onto one fibre
    const r = compute(
      project(
        [
          { id: "t1", model: "dwdm-tunable", settings: { channel: "C21" } },
          { id: "t2", model: "dwdm-tunable", settings: { channel: "C21" } },
          { id: "sp", model: "split-50" },
          { id: "rx", model: "grey-1550" },
        ],
        [ideal("p1", "t1.tx", "sp.out1"), ideal("p2", "t2.tx", "sp.out2"), fibre("f", "g652d", "sp.in", "rx.rx", { length_km: 1, ja: "lc-upc", jb: "lc-upc" })],
      ),
      catalog(),
    );
    const i = issues(r, "topology.duplicate_channel", "f");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("error");
    expect(r.fibres.find((f) => f.id === "f")!.status).toBe("fail");
  });
  it("splitter fans a signal out into one result per branch", () => {
    const r = compute(
      project(
        [
          { id: "tx", model: "grey-1550" },
          { id: "sp", model: "split-50" },
          { id: "r1", model: "grey-1550" },
          { id: "r2", model: "grey-1550" },
        ],
        [ideal("p0", "tx.tx", "sp.in"), ideal("p1", "sp.out1", "r1.rx"), ideal("p2", "sp.out2", "r2.rx")],
      ),
      catalog(),
    );
    const a = sig(r, "tx.tx:1550nm");
    const b = sig(r, "tx.tx:1550nm#2");
    expect([a.rx!.node, b.rx!.node].sort()).toEqual(["r1", "r2"]);
    // 10·log10(100/50) = 3.01 dB per leg
    near(a.powerAtEnd.typ, -3.01);
    near(b.powerAtEnd.typ, -3.01);
    // the shared input is recorded once
    expect(r.ports.find((p) => p.node === "sp" && p.port === "in")!.in.channels).toHaveLength(1);
  });
  it("wavelength outside a fibre attenuation table → fibre.wavelength_out_of_table", () => {
    const r = compute(
      project(
        [
          { id: "tx", model: "grey-1271" },
          { id: "rx", model: "grey-1550" },
        ],
        [fibre("f", "g652d", "tx.tx", "rx.rx", { length_km: 1, ja: "lc-upc", jb: "lc-upc" })],
      ),
      catalog(),
    );
    // table covers 1310…1625 nm; 1271 nm is clamped to the 1310 value (0.35 dB/km) and reported once
    const i = issues(r, "fibre.wavelength_out_of_table", "f");
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe("error");
    near(-sig(r, "tx.tx:1271nm").path.find((p) => p.element === "f")!.deltaPower.typ, 0.35);
  });
});
