import { expect, test } from "vitest";
import { openProject } from "../src/index.js";

test("large project (500 nodes / 5000 fibres in 5 files): open and apply stay fast", () => {
  const files: Record<string, string> = {};
  const inc: string[] = [];
  for (let f = 0; f < 5; f++) {
    let t = `# part ${f}\nnodes:\n`;
    for (let i = 0; i < 100; i++) t += `  - { id: n${f}-${i}, model: m, site: s }   # node ${i}\n`;
    t += "fibres:\n";
    for (let i = 0; i < 1000; i++) t += `  - id: f${f}-${i}\n    type: g652d\n    length_km: ${i % 50}\n    a: { to: n${f}-${i % 100}.out }\n    b: { to: n${f}-${(i + 1) % 100}.in }\n`;
    t += "layout:\n  nodes:\n";
    for (let i = 0; i < 100; i++) t += `    n${f}-${i}: { x: ${i * 10}, y: ${f * 100} }\n`;
    files[`part${f}.yaml`] = t;
    inc.push(`  - { file: part${f}.yaml }`);
  }
  files["project.yaml"] = `optiplanner: 1\nincludes:\n${inc.join("\n")}\nproject: { name: Big }\n`;
  let t0 = performance.now();
  const s = openProject("project.yaml", files);
  const openMs = performance.now() - t0;
  expect(s.issues).toEqual([]);
  expect(s.model.fibres).toHaveLength(5000);
  t0 = performance.now();
  for (let k = 0; k < 10; k++) s.apply([{ op: "setLayout", kind: "node", id: "n3-50", rect: { x: k, y: k } }]);
  const applyMs = (performance.now() - t0) / 10;
  t0 = performance.now();
  s.apply([{ op: "moveToFile", kind: "fibre", id: "f1-500", file: "part4.yaml" }]);
  const moveMs = performance.now() - t0;
  console.log(`open ${openMs.toFixed(0)} ms, setLayout ${applyMs.toFixed(0)} ms/op, moveToFile ${moveMs.toFixed(0)} ms`);
  expect(s.changedFiles()).toEqual(["part1.yaml", "part3.yaml", "part4.yaml"]);
  expect(applyMs).toBeLessThan(1000);
});
