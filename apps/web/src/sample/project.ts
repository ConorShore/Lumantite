/** Bundled multi-file sample project, loaded when /api/projects is unreachable. */

export const SAMPLE_ROOT = "sample/project.yaml";

const CH = [21, 22, 23, 24];

const parent = `# Sample project bundled with the web app (used when the server is unreachable).
optiplanner: 1
includes:
  - { file: sites/exchange-a.yaml, label: Exchange A }
  - { file: sites/exchange-b.yaml, label: Exchange B }
  - { file: spans.yaml, label: Inter-site spans }
project:
  name: Metro ring east (sample)
  wavelength_plans: [dwdm-c-100ghz-40]
  margins:
    system_margin_dB: 3.0
    ageing_dB: 1.0

sites:
  - { id: siteA, name: Exchange A }
  - { id: siteB, name: Exchange B }

layout:
  sites:
    siteA: { x: -20, y: -20, w: 560, h: 560 }
    siteB: { x: 1160, y: -20, w: 560, h: 560 }
  files:
    sites/exchange-a.yaml: { x: -50, y: -60, w: 620, h: 630 }
    sites/exchange-b.yaml: { x: 1130, y: -60, w: 620, h: 630 }
    spans.yaml: { x: 620, y: -60, w: 460, h: 630 }
    sample/project.yaml: { x: -50, y: 600, w: 300, h: 120 }
`;

const site = (s: "A" | "B") => {
  const other = s === "A" ? "B" : "A";
  const xs = s === "A" ? { sfp: 0, mux: 200, amp: 380 } : { sfp: 1540, mux: 1320, amp: 1180 };
  const lines: string[] = [
    `# Exchange ${s}: ${s === "A" ? "head end with booster" : "far end"}`,
    "nodes:",
    `  - { id: ${s}-sw1, model: generic-host, site: site${s} }`,
  ];
  for (const c of CH) lines.push(`  - { id: ${s}-sfp-${c}, model: fs-sfp-10g-dwdm-c${c}-80km, site: site${s}, host: ${s}-sw1, slot: Eth1/${c - 20}${s === "B" && c === 24 ? ", settings: { tx_power_override_dBm: -2 }" : ""} }`);
  lines.push(`  - { id: ${s}-mux, model: generic-dwdm-40ch-100ghz, site: site${s} }   # towards ${other}`);
  lines.push(`  - { id: ${s}-demux, model: generic-dwdm-40ch-100ghz, site: site${s} } # from ${other}`);
  if (s === "A") lines.push(`  - id: A-amp\n    model: acme-edfa-ba-20\n    site: siteA\n    settings: { mode: constant_gain, gain_dB: 10 }`);
  lines.push("", "fibres:", "  # Tx patches into the mux, demux patches into the Rx");
  for (const c of CH) lines.push(`  - { id: ${s}-p-tx${c}, type: lc-patch, a: { to: ${s}-sfp-${c}.tx }, b: { to: ${s}-mux.C${c} } }`);
  for (const c of CH) lines.push(`  - { id: ${s}-p-rx${c}, type: lc-patch, a: { to: ${s}-demux.C${c} }, b: { to: ${s}-sfp-${c}.rx } }`);
  if (s === "A") lines.push(`  - { id: A-p-amp, type: lc-patch, a: { to: A-mux.common }, b: { to: A-amp.in } }`);
  lines.push("", "layout:", "  nodes:");
  lines.push(`    ${s}-sw1: { x: ${xs.sfp}, y: 440 }`);
  CH.forEach((c, i) => lines.push(`    ${s}-sfp-${c}: { x: ${xs.sfp}, y: ${i * 100} }`));
  lines.push(`    ${s}-mux: { x: ${xs.mux}, y: ${s === "A" ? 20 : 260} }`);
  lines.push(`    ${s}-demux: { x: ${xs.mux}, y: ${s === "A" ? 260 : 20} }`);
  if (s === "A") lines.push(`    A-amp: { x: ${xs.amp}, y: 40 }`);
  return lines.join("\n") + "\n";
};

const spans = `# Inter-site spans. A→B is two sections joined by a fusion splice.
fibres:
  - id: span-AB-1
    type: g652d
    length_km: 60
    a: { joint: lc-upc, to: A-amp.out }
    b: { joint: fusion-splice, to: span-AB-2.a }
  - id: span-AB-2
    type: g652d
    length_km: 21
    a: { joint: fusion-splice, to: span-AB-1.b }
    b: { joint: lc-upc, to: B-demux.common }
  # Return path, unamplified
  - id: span-BA
    type: g652d
    length_km: 44
    a: { joint: lc-upc, to: B-mux.common }
    b: { joint: lc-upc, to: A-demux.common }
`;

export const SAMPLE_PROJECT_FILES: Record<string, string> = {
  [SAMPLE_ROOT]: parent,
  "sample/sites/exchange-a.yaml": site("A"),
  "sample/sites/exchange-b.yaml": site("B"),
  "sample/spans.yaml": spans,
};
