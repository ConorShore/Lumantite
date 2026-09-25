import { z } from "zod";
import { Ext, NumOrRange, Ports, WlRow, WlSpec } from "./common.js";
import { WavelengthPlan } from "./plans.js";

/** Fields common to every catalog model. */
const base = {
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/i, "id: letters, digits, . _ -"),
  vendor: z.string().optional(),
  model: z.string().optional(),
  description: z.string().optional(),
  /** Datasheet / standard the numbers came from. */
  source: z.string().optional(),
  /** Inherit from another model of the same kind; this model's fields win (deep merge). */
  extends: z.string().optional(),
  x: Ext.optional(),
};

// ---------- transceiver ----------
export const TxWavelength = z.union([
  z.object({ plan: z.string(), channel: z.string() }),                                   // fixed WDM channel
  z.object({ plan: z.string(), channels: z.union([z.literal("all"), z.array(z.string())]) }), // tunable
  z.object({ wavelength_nm: z.number() }),                                               // grey optics
]);
export type TxWavelength = z.infer<typeof TxWavelength>;

export const TransceiverModel = z.object({
  kind: z.literal("transceiver"),
  ...base,
  form_factor: z.string().optional(),
  rate_Gbps: z.number().optional(),
  reach_km: z.number().optional(),
  tx: z.object({
    wavelength: TxWavelength,
    power_dBm: NumOrRange,
  }),
  rx: z.object({
    sensitivity_dBm: z.number(),
    overload_dBm: z.number(),
    /** Scalar means ±value. */
    cd_tolerance_ps_nm: z.union([z.number(), z.object({ min: z.number(), max: z.number() })]).optional(),
    wavelength_range_nm: z.tuple([z.number(), z.number()]).optional(),
    /** Stored only in v1. */
    min_osnr_dB: z.number().optional(),
  }),
  /**
   * Default: { tx: {direction: out}, rx: {direction: in} }.
   * BiDi optics: { bidi: {direction: bidi} } and tx.wavelength / rx.wavelength_range differ.
   */
  ports: Ports.optional(),
  /** Default connector for ports that don't set one. */
  connector: z.string().optional(),
});
export type TransceiverModel = z.infer<typeof TransceiverModel>;

// ---------- fibre ----------
export const DispersionModel = z.discriminatedUnion("model", [
  z.object({
    model: z.literal("g652"),
    zero_dispersion_nm: z.number(),
    zero_dispersion_slope_ps_nm2_km: z.number(),
  }),
  z.object({
    model: z.literal("linear"),
    d0_ps_nm_km: z.number(),
    at_nm: z.number(),
    slope_ps_nm2_km: z.number(),
  }),
  z.object({ model: z.literal("table"), table: z.array(WlRow).min(1) }),
  z.object({ model: z.literal("none") }),
]);
export type DispersionModel = z.infer<typeof DispersionModel>;

export const FibreModel = z.object({
  kind: z.literal("fibre"),
  ...base,
  standard: z.string().optional(),
  multimode: z.boolean().optional(),
  attenuation_dB_per_km: WlSpec,
  dispersion: DispersionModel,
  /** Aggregate launch power limit, dBm. */
  max_power_dBm: z.number().optional(),
  default_joint: z.string().optional(),
  default_length_km: z.number().optional(),
});
export type FibreModel = z.infer<typeof FibreModel>;

// ---------- joint (connector or splice) ----------
export const JointModel = z.object({
  kind: z.literal("joint"),
  ...base,
  /** Connector family, e.g. LC, SC, E2000, MPO, splice. Must match at ports and fibre-to-fibre. */
  family: z.string(),
  polish: z.string().optional(),
  insertion_loss_dB: NumOrRange,
  return_loss_dB: z.number().optional(),
});
export type JointModel = z.infer<typeof JointModel>;

// ---------- mux / demux / OADM ----------
export const MuxModel = z.object({
  kind: z.literal("mux"),
  ...base,
  plan: z.string(),
  channel_ports: z.union([z.literal("all"), z.array(z.string())]),
  insertion_loss_dB: WlSpec,
  port_overrides: z.record(z.string(), z.object({ insertion_loss_dB: WlSpec })).optional(),
  express_port: z.object({ insertion_loss_dB: WlSpec }).optional(),
  monitor_port: z.object({ tap_dB: z.number() }).optional(),
  isolation_dB: z.number().optional(),
  passband_ghz: z.number().optional(),
  /** Default connector for every port. */
  connector: z.string().optional(),
  /** Per-port overrides; channel ports are generated from plan/channel_ports. */
  ports: Ports.optional(),
});
export type MuxModel = z.infer<typeof MuxModel>;

// ---------- amplifier ----------
export const AmpMode = z.enum(["constant_gain", "constant_output_power"]);
export type AmpMode = z.infer<typeof AmpMode>;

export const GainSpectrumPoint = z.object({
  input_power_total_dBm: z.number(),
  gain_setting_dB: z.number(),
  spectrum: z.array(z.object({ nm: z.number(), gain_dB: z.number() })).min(1),
});
export type GainSpectrumPoint = z.infer<typeof GainSpectrumPoint>;

export const AmplifierModel = z.object({
  kind: z.literal("amplifier"),
  ...base,
  band_nm: z.tuple([z.number(), z.number()]),
  modes: z.array(AmpMode).min(1),
  gain_dB: z.object({ min: z.number(), max: z.number() }),
  input_power_total_dBm: z.object({ min: z.number(), max: z.number() }),
  output_power_total_dBm: z.object({ max: z.number() }),
  /** ± ripple over the band (parametric model worst case). */
  gain_flatness_dB: z.number().optional(),
  /** Relative gain vs wavelength at nominal setting (parametric model). */
  gain_tilt: z.array(z.object({ nm: z.number(), dB: z.number() })).optional(),
  noise_figure_dB: z.number().optional(),
  gain_model: z.enum(["parametric", "measured"]).optional(),
  gain_spectrum: z.array(GainSpectrumPoint).optional(),
  measurement_uncertainty_dB: z.number().optional(),
  connector: z.string().optional(),
  ports: Ports.optional(), // default { in: {direction: in}, out: {direction: out} }
});
export type AmplifierModel = z.infer<typeof AmplifierModel>;

// ---------- simple passives ----------
export const AttenuatorModel = z.object({
  kind: z.literal("attenuator"),
  ...base,
  /** Fixed attenuator. */
  loss_dB: WlSpec.optional(),
  /** VOA: instance sets `setting_dB` within this range. */
  range_dB: z.object({ min: z.number(), max: z.number() }).optional(),
  connector: z.string().optional(),
  ports: Ports.optional(), // default { in: bidi, out: bidi }
});
export type AttenuatorModel = z.infer<typeof AttenuatorModel>;

export const DcmModel = z.object({
  kind: z.literal("dcm"),
  ...base,
  /** Negative for compensation. Scalar or wavelength table. */
  dispersion_ps_nm: z.union([z.number(), z.array(WlRow).min(1)]),
  insertion_loss_dB: WlSpec,
  connector: z.string().optional(),
  ports: Ports.optional(),
});
export type DcmModel = z.infer<typeof DcmModel>;

export const SplitterModel = z.object({
  kind: z.literal("splitter"),
  ...base,
  /** Percent per output leg, e.g. [50, 50] or [90, 10]. Ports: in, out1..outN. */
  ratio: z.array(z.number().positive()).min(2),
  excess_loss_dB: NumOrRange.optional(),
  connector: z.string().optional(),
  ports: Ports.optional(),
});
export type SplitterModel = z.infer<typeof SplitterModel>;

export const PassthroughModel = z.object({
  kind: z.literal("passthrough"),
  ...base,
  insertion_loss_dB: WlSpec,
  /** Bidirectional port pairs. Default [["in","out"]]. Ports are generated from this. */
  paths: z.array(z.tuple([z.string(), z.string()])).optional(),
  connector: z.string().optional(),
  ports: Ports.optional(),
});
export type PassthroughModel = z.infer<typeof PassthroughModel>;

export const HostModel = z.object({
  kind: z.literal("host"),
  ...base,
  slots: z.array(z.string()).optional(),
});
export type HostModel = z.infer<typeof HostModel>;

// ---------- union ----------
export const DeviceModel = z.discriminatedUnion("kind", [
  TransceiverModel, FibreModel, JointModel, MuxModel, AmplifierModel,
  AttenuatorModel, DcmModel, SplitterModel, PassthroughModel, HostModel,
]);
export type DeviceModel = z.infer<typeof DeviceModel>;
export type DeviceKind = DeviceModel["kind"];
export const DEVICE_KINDS = [
  "transceiver", "fibre", "joint", "mux", "amplifier",
  "attenuator", "dcm", "splitter", "passthrough", "host",
] as const satisfies readonly DeviceKind[];

export const CatalogEntry = z.union([DeviceModel, WavelengthPlan]);
export type CatalogEntry = z.infer<typeof CatalogEntry>;

/**
 * Loose shape used before `extends` resolution: only kind/id/extends are checked.
 * Resolve (deep-merge parent → child), then validate with `DeviceModel`.
 */
export const CatalogEntryLoose = z.object({
  kind: z.string(),
  id: z.string(),
  extends: z.string().optional(),
}).passthrough();
export type CatalogEntryLoose = z.infer<typeof CatalogEntryLoose>;
