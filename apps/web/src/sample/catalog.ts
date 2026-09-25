/** Small bundled catalog used when the server is unreachable (dev without apps/server). */

function dwdm40(): string {
  const lines = [
    "kind: wavelength-plan",
    "id: dwdm-c-100ghz-40",
    "name: DWDM C-band 100 GHz, 40 channels",
    "source: ITU-T G.694.1",
    "channels:",
  ];
  for (let n = 21; n <= 60; n++) lines.push(`  - { id: C${n}, frequency_GHz: ${192100 + (n - 21) * 100} }`);
  return lines.join("\n");
}
function cwdm18(): string {
  const lines = ["kind: wavelength-plan", "id: cwdm-18", "name: CWDM 18 channels", "source: ITU-T G.694.2", "channels:"];
  for (let nm = 1271; nm <= 1611; nm += 20) lines.push(`  - { id: "${nm}", wavelength_nm: ${nm} }`);
  return lines.join("\n");
}

const plans = `# Wavelength plans (sample)\n${dwdm40()}\n---\n${cwdm18()}\n`;

const joints = `# Connectors and splices
- kind: joint
  id: lc-upc
  family: LC
  polish: UPC
  insertion_loss_dB: { min: 0.1, typ: 0.25, max: 0.5 }
  return_loss_dB: 50
- kind: joint
  id: sc-upc
  family: SC
  polish: UPC
  insertion_loss_dB: { min: 0.1, typ: 0.25, max: 0.5 }
- kind: joint
  id: fusion-splice
  family: splice
  insertion_loss_dB: { min: 0.02, typ: 0.05, max: 0.1 }
`;

const fibres = `- kind: fibre
  id: g652d
  description: ITU-T G.652.D single-mode
  attenuation_dB_per_km:
    - { nm: 1310, value: 0.35 }
    - { nm: 1383, value: 0.35 }
    - { nm: 1490, value: 0.24 }
    - { nm: 1550, value: 0.20 }
    - { nm: 1625, value: 0.22 }
  dispersion: { model: g652, zero_dispersion_nm: 1310, zero_dispersion_slope_ps_nm2_km: 0.092 }
  max_power_dBm: 20
  default_joint: fusion-splice
- kind: fibre
  id: lc-patch
  extends: g652d
  description: LC/UPC patch cord, 2 m
  default_length_km: 0.002
  default_joint: lc-upc
`;

const transceivers = `- kind: transceiver
  id: generic-10g-dwdm-80km
  description: Generic 10G DWDM SFP+, 80 km
  form_factor: SFP+
  rate_Gbps: 10
  reach_km: 80
  tx:
    wavelength: { plan: dwdm-c-100ghz-40, channel: C21 }
    power_dBm: { min: 0, typ: 2, max: 4 }
  rx:
    sensitivity_dBm: -24
    overload_dBm: -7
    cd_tolerance_ps_nm: { min: -800, max: 1600 }
    wavelength_range_nm: [1260, 1620]
${[21, 22, 23, 24].map((c) => `- kind: transceiver
  id: fs-sfp-10g-dwdm-c${c}-80km
  vendor: FS
  model: SFP-10G-DWDM-C${c}-80
  extends: generic-10g-dwdm-80km
  tx: { wavelength: { plan: dwdm-c-100ghz-40, channel: C${c} } }`).join("\n")}
- kind: transceiver
  id: generic-10g-dwdm-tunable
  extends: generic-10g-dwdm-80km
  description: Tunable 10G DWDM SFP+
  tx: { wavelength: { plan: dwdm-c-100ghz-40, channels: all } }
- kind: transceiver
  id: generic-10g-lr
  description: 10GBASE-LR, 1310 nm, 10 km
  tx:
    wavelength: { wavelength_nm: 1310 }
    power_dBm: { min: -8.2, typ: -3, max: 0.5 }
  rx:
    sensitivity_dBm: -14.4
    overload_dBm: 0.5
`;

const muxes = `- kind: mux
  id: generic-dwdm-40ch-100ghz
  description: 40-channel DWDM mux/demux, 100 GHz
  plan: dwdm-c-100ghz-40
  channel_ports: all
  insertion_loss_dB: { min: 2.5, typ: 3.0, max: 3.5 }
  express_port: { insertion_loss_dB: { typ: 1.0, max: 1.5 } }
- kind: mux
  id: generic-oadm-4ch-c21
  description: 4-channel OADM C21-C24
  plan: dwdm-c-100ghz-40
  channel_ports: [C21, C22, C23, C24]
  insertion_loss_dB: { min: 1.0, typ: 1.5, max: 2.0 }
`;

const amplifiers = `- kind: amplifier
  id: acme-edfa-ba-20
  description: EDFA booster, 20 dBm
  band_nm: [1528, 1566]
  modes: [constant_gain, constant_output_power]
  gain_dB: { min: 10, max: 23 }
  input_power_total_dBm: { min: -30, max: 5 }
  output_power_total_dBm: { max: 20 }
  gain_flatness_dB: 1.0
  gain_tilt:
    - { nm: 1528, dB: 0.5 }
    - { nm: 1566, dB: -0.5 }
  noise_figure_dB: 5.5
- kind: amplifier
  id: generic-edfa-pa
  description: EDFA pre-amp
  band_nm: [1528, 1566]
  modes: [constant_gain]
  gain_dB: { min: 15, max: 30 }
  input_power_total_dBm: { min: -40, max: -10 }
  output_power_total_dBm: { max: 13 }
`;

const passives = `- kind: attenuator
  id: att-5db
  loss_dB: { min: 4.5, typ: 5, max: 5.5 }
- kind: attenuator
  id: voa-0-20
  range_dB: { min: 0, max: 20 }
- kind: dcm
  id: dcm-680
  dispersion_ps_nm: -680
  insertion_loss_dB: { typ: 5, max: 6 }
- kind: splitter
  id: splitter-90-10
  ratio: [90, 10]
  excess_loss_dB: { typ: 0.2, max: 0.5 }
- kind: passthrough
  id: patch-panel-lc
  insertion_loss_dB: 0
- kind: host
  id: generic-host
  description: Switch / router chassis
`;

export const SAMPLE_CATALOG_FILES: Record<string, string> = {
  "wavelength-plans.yaml": plans,
  "joints.yaml": joints,
  "fibres.yaml": fibres,
  "transceivers.yaml": transceivers,
  "muxes.yaml": muxes,
  "amplifiers.yaml": amplifiers,
  "passives.yaml": passives,
};
