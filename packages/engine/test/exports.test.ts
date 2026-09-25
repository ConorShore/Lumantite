import { describe, expect, it } from "vitest";
import { compute, toMarkdown, toPortsCsv, toSignalsCsv } from "../src/index.js";
import { catalog, fibre, ideal, project } from "./fixtures.js";

/** Minimal RFC 4180 parser for round-trip checks. */
function parseCsv(text: string, d = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        f += '"';
        i++;
      } else if (ch === '"') q = false;
      else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) {
      row.push(f);
      f = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(f);
      rows.push(row);
      row = [];
      f = "";
      i++;
    } else f += ch;
  }
  return rows;
}

const model = project(
  [
    { id: 'tx"1,x', model: "grey-1550" },
    { id: "amp", model: "edfa", settings: { mode: "constant_gain", gain_dB: 10 } },
    { id: "rx", model: "grey-1550" },
  ],
  [ideal("p1", 'tx"1,x.tx', "amp.in"), fibre("f", "g652d", "amp.out", "rx.rx", { length_km: 10, ja: "lc-upc", jb: "lc-upc" })],
);
const r = compute(model, catalog());

describe("toSignalsCsv", () => {
  const rows = parseCsv(toSignalsCsv(r));
  it("header first, one row per signal", () => {
    expect(rows[0].slice(0, 4)).toEqual(["signal", "tx", "rx", "channel"]);
    expect(rows).toHaveLength(1 + r.signals.length);
  });
  it("RFC 4180 quoting round-trips ids with quotes and delimiters", () => {
    const text = toSignalsCsv(r);
    expect(text).toContain('"tx""1,x.tx:1550nm"');
    const row = rows.find((x) => x[0] === 'tx"1,x.tx:1550nm')!;
    const h = rows[0];
    expect(row[h.indexOf("rx")]).toBe("rx.rx");
    // 0 + 10 − 2.0 − 0.5 = 7.5 dBm
    expect(row[h.indexOf("rx_power_typ_dBm")]).toBe("7.50");
    expect(row[h.indexOf("status")]).toBe(r.signals.find((s) => s.id === row[0])!.status);
  });
  it("custom delimiter", () => {
    const text = toSignalsCsv(r, ";");
    expect(text.split("\r\n")[0].split(";")[0]).toBe("signal");
    expect(text).toContain('tx"1,x.tx:1550nm'.replace(/"/g, '""'));
  });
});

describe("toPortsCsv", () => {
  const rows = parseCsv(toPortsCsv(r));
  const h = rows[0];
  it("channel rows and one summary row per port", () => {
    expect(h[0]).toBe("row_type");
    const summaries = rows.filter((x) => x[0] === "port");
    expect(summaries).toHaveLength(r.ports.length);
    const ampIn = rows.find((x) => x[0] === "channel" && x[1] === "amp" && x[2] === "in")!;
    expect(ampIn[h.indexOf("direction")]).toBe("in");
    expect(ampIn[h.indexOf("power_typ_dBm")]).toBe("0.00");
    const ampOut = summaries.find((x) => x[1] === "amp" && x[2] === "out")!;
    expect(ampOut[h.indexOf("channel_count")]).toBe("1");
  });
});

describe("toMarkdown", () => {
  const md = toMarkdown(model, r);
  it("has summary, link budget tables, amplifier table and issues", () => {
    expect(md).toContain("# test — optical link budget");
    expect(md).toContain("## Summary");
    expect(md).toContain("| Element | Kind | Δ min / typ / max (dB) | Cumulative min / typ / max (dBm) | CD (ps/nm) |");
    expect(md).toContain("## Amplifiers");
    expect(md).toContain("| amp | constant_gain | parametric |");
    expect(md).toContain("## Issues");
    expect(md).toContain("`topology.rx_no_signal`");
  });
});
