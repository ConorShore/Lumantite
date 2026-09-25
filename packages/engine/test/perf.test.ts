/** SPEC §12 T25: generated 500-node / 5 000-fibre / 40-channel project computes in < 2 s. */
import { describe, expect, it } from "vitest";
import type { FibreInst, NodeInst } from "@lumantite/schema";
import { compute } from "../src/index.js";
import { catalog, project } from "./fixtures.js";

function generate() {
  const SYSTEMS = 6;
  const chans = catalog().channels("dwdm-c-100ghz-40").map((c) => c.id);
  const nodes: (NodeInst & { id: string; model: string })[] = [
    { id: "hostA", model: "host" },
    { id: "hostB", model: "host" },
  ];
  const fibres: (Partial<FibreInst> & { id: string; type: string })[] = [];
  // per system: 40 Tx + 40 Rx + mux + demux + amp = 83 nodes → 6 × 83 + 2 hosts = 500
  // per system: 40 + 40 patches + 1 mux→amp patch + K spliced span sections
  const fixed = SYSTEMS * 81;
  const spanTotal = 5000 - fixed;
  for (let s = 0; s < SYSTEMS; s++) {
    const K = Math.floor(spanTotal / SYSTEMS) + (s < spanTotal % SYSTEMS ? 1 : 0);
    const mux = `s${s}-mux`;
    const amp = `s${s}-amp`;
    const demux = `s${s}-demux`;
    nodes.push({ id: mux, model: "mux40" }, { id: amp, model: "edfa", settings: { mode: "constant_output_power", output_power_dBm: 17 } }, { id: demux, model: "mux40" });
    for (const ch of chans) {
      nodes.push({ id: `s${s}-tx-${ch}`, model: "dwdm-tunable", settings: { channel: ch } });
      nodes.push({ id: `s${s}-rx-${ch}`, model: "dwdm-tunable", settings: { channel: ch } });
      fibres.push({ id: `s${s}-pt-${ch}`, type: "lc-patch", a: { to: `s${s}-tx-${ch}.tx` }, b: { to: `${mux}.${ch}` } });
      fibres.push({ id: `s${s}-pr-${ch}`, type: "lc-patch", a: { to: `${demux}.${ch}` }, b: { to: `s${s}-rx-${ch}.rx` } });
    }
    fibres.push({ id: `s${s}-pm`, type: "lc-patch", a: { to: `${mux}.common` }, b: { to: `${amp}.in` } });
    // K spliced sections of 0.1 km between amp.out and demux.common
    for (let k = 0; k < K; k++) {
      const id = `s${s}-span-${k}`;
      fibres.push({
        id,
        type: "g652d",
        length_km: 0.1,
        a: k === 0 ? { to: `${amp}.out`, joint: "lc-upc" } : { to: `s${s}-span-${k - 1}.b` },
        b: k === K - 1 ? { to: `${demux}.common`, joint: "lc-upc" } : { to: `s${s}-span-${k + 1}.a` },
      });
    }
  }
  return project(nodes, fibres);
}

describe("T25 performance", () => {
  const m = generate();
  it("fixture has 500 nodes and 5 000 fibres, 40 channels", () => {
    expect(m.nodes).toHaveLength(500);
    expect(m.fibres).toHaveLength(5000);
  });
  it("full compute < 2 s", () => {
    compute(m, catalog()); // warm-up (JIT)
    const t0 = performance.now();
    const r = compute(m, catalog());
    const ms = performance.now() - t0;
    // sanity: every system's 40 channels reach their receivers
    expect(r.signals.filter((s) => s.terminated === "rx")).toHaveLength(6 * 40);
    expect(r.amplifiers).toHaveLength(6);
    expect(r.issues.filter((i) => i.code.startsWith("project.") || i.code.startsWith("catalog."))).toHaveLength(0);
    console.log(`T25 compute: ${ms.toFixed(0)} ms, ${r.signals.length} signals, ${r.issues.length} issues`);
    expect(ms).toBeLessThan(2000);
  });
});
