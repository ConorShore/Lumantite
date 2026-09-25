/** Realistic split project mirroring SPEC §6: parent + two site fragments + a spans fragment. */

export const PROJECT_YAML = `# Metro ring east — parent file
lumantite: 1
includes:
  - { file: sites/a.yaml, label: Exchange A }
  - { file: ./sites/b.yaml, label: Exchange B }
  - { file: spans.yaml,     label: Inter-site spans }
project:
  name: Metro ring east
  wavelength_plans: [dwdm-c-100ghz-40]
  margins:                      # editable on the Margins page (see 7.8)
    system_margin_dB: 3.0
    ageing_dB: 1.0
    repair_splices: 2
    repair_splice_loss_dB: 0.1
    connector_ageing_dB: 0.0
    cd_margin_pct: 10
    max_channel_imbalance_dB: 6

sites:
  - { id: siteA, name: Exchange A }
  - { id: siteB, name: Exchange B }   # receive end

layout:                         # canvas positions; never affects calculations
  sites: { siteA: { x: 0, y: 0, w: 400, h: 300 }, siteB: { x: 800, y: 0, w: 400, h: 300 } }
  files:
    sites/a.yaml: { x: -20, y: -20, w: 440, h: 340 }
    sites/b.yaml: { x: 780, y: -20, w: 440, h: 340 }
`;

export const SITE_A_YAML = `# Exchange A — transmit side
nodes:
  - { id: A-sw1, model: generic-host, site: siteA }
  # 10G DWDM optic, channel 21
  - { id: A-sfp-21, model: fs-sfp-10g-dwdm-c21-80km, site: siteA, host: A-sw1, slot: Eth1/1 }
  - { id: A-mux,  model: generic-dwdm-40ch-100ghz, site: siteA }   # 40ch mux
  - { id: A-amp,  model: acme-edfa-ba-20, site: siteA,
      settings: { mode: constant_gain, gain_dB: 20 } }

fibres:
  - { id: p1, type: lc-patch, a: { to: A-sfp-21.tx }, b: { to: A-mux.C21 } }
  - { id: p2, type: lc-patch, a: { to: A-mux.common }, b: { to: A-amp.in } }

layout:
  nodes: { A-mux: { x: 120, y: 80 }, A-amp: { x: 260, y: 80 } }
`;

export const SITE_B_YAML = `# Exchange B — receive side
nodes:
  - id: B-demux
    model: generic-dwdm-40ch-100ghz   # same model as the mux
    site: siteB

  - id: B-sfp-21
    model: fs-sfp-10g-dwdm-c21-80km
    site: siteB

fibres:
  - { id: p3, type: lc-patch, a: { to: B-demux.C21 }, b: { to: B-sfp-21.rx } }

layout:
  nodes:
    B-demux: { x: 900, y: 80 }
    B-sfp-21: { x: 1040, y: 80 }
`;

export const SPANS_YAML = `# Inter-site spans
fibres:
  # 60 km to the splice point
  - id: span-AB-1
    type: g652d
    length_km: 60
    a: { joint: lc-upc,        to: A-amp.out }
    b: { joint: fusion-splice, to: span-AB-2.a }
  - id: span-AB-2
    type: g652d
    length_km: 20
    a: { joint: fusion-splice, to: span-AB-1.b }
    b: { joint: lc-upc,        to: B-demux.common }
`;

export function projectFiles(prefix = ""): Record<string, string> {
  return {
    [`${prefix}project.yaml`]: PROJECT_YAML,
    [`${prefix}sites/a.yaml`]: SITE_A_YAML,
    [`${prefix}sites/b.yaml`]: SITE_B_YAML,
    [`${prefix}spans.yaml`]: SPANS_YAML,
  };
}

/** Replace exactly one occurrence of `from` (fails loudly if absent or ambiguous). */
export function replaceOnce(text: string, from: string, to: string): string {
  const i = text.indexOf(from);
  if (i < 0) throw new Error(`fixture edit: "${from}" not found`);
  if (text.indexOf(from, i + 1) >= 0) throw new Error(`fixture edit: "${from}" is ambiguous`);
  return text.slice(0, i) + to + text.slice(i + from.length);
}
