import { z } from "zod";
import { Ext } from "./common.js";

export const Margins = z.object({
  system_margin_dB: z.number().optional(),
  ageing_dB: z.number().optional(),
  repair_splices: z.number().int().nonnegative().optional(),
  repair_splice_loss_dB: z.number().optional(),
  connector_ageing_dB: z.number().optional(),
  cd_margin_pct: z.number().optional(),
  max_channel_imbalance_dB: z.number().optional(),
  /** × path length, added to the Rx penalty (SPEC 7.10 R19). */
  repair_loss_dB_per_km: z.number().optional(),
  /** Subtracted from OSNR before the min_osnr comparison (SPEC 7.10 R16). */
  osnr_margin_dB: z.number().optional(),
  /** Lowest acceptable per-channel amplifier input (SPEC 7.10 R4). */
  amp_min_channel_input_dBm: z.number().optional(),
  /** Minimum signal-to-adjacent-crosstalk ratio at demux ports (SPEC 7.10 R17). */
  min_crosstalk_ratio_dB: z.number().optional(),
});
export type Margins = z.infer<typeof Margins>;
export type ResolvedMargins = Required<Margins>;
export const DEFAULT_MARGINS: ResolvedMargins = {
  system_margin_dB: 3.0,
  ageing_dB: 1.0,
  repair_splices: 2,
  repair_splice_loss_dB: 0.1,
  connector_ageing_dB: 0.0,
  cd_margin_pct: 10,
  max_channel_imbalance_dB: 6,
  repair_loss_dB_per_km: 0,
  osnr_margin_dB: 3,
  amp_min_channel_input_dBm: -25,
  min_crosstalk_ratio_dB: 20,
};

export const ProjectMeta = z.object({
  name: z.string(),
  description: z.string().optional(),
  wavelength_plans: z.array(z.string()).optional(),
  margins: Margins.optional(),
  x: Ext.optional(),
});
export type ProjectMeta = z.infer<typeof ProjectMeta>;

export const Site = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  parent: z.string().optional(),
  x: Ext.optional(),
});
export type Site = z.infer<typeof Site>;

/** Per-instance settings; keys depend on the device kind (see SPEC §5). */
export const NodeSettings = z.object({
  channel: z.string().optional(),            // tunable transceiver
  tx_power_override_dBm: z.number().optional(),
  mode: z.enum(["constant_gain", "constant_output_power"]).optional(),
  gain_dB: z.number().optional(),
  output_power_dBm: z.number().optional(),
  tilt_dB: z.number().optional(),            // linear tilt across band, + = more gain at long λ
  gain_model: z.enum(["parametric", "measured"]).optional(),
  setting_dB: z.number().optional(),         // VOA
  design_channels: z.number().int().positive().optional(), // amplifier full-load channel count (SPEC 7.10 R2)
  port_side: z.enum(["right", "left", "split"]).optional(), // transceiver canvas only: where tx/rx sit (default right); ignored by the engine
}).passthrough();
export type NodeSettings = z.infer<typeof NodeSettings>;

export const NodeInst = z.object({
  id: z.string(),
  model: z.string(),
  name: z.string().optional(),
  site: z.string().optional(),
  host: z.string().optional(),
  slot: z.string().optional(),
  settings: NodeSettings.optional(),
  x: Ext.optional(),
});
export type NodeInst = z.infer<typeof NodeInst>;

/** `to` is "node.port" or "fibre.a" / "fibre.b". Mux channel ports are named by channel id, e.g. "A-mux.C21". */
export const FibreEnd = z.object({
  joint: z.string().optional(),
  to: z.string().optional(),
});
export type FibreEnd = z.infer<typeof FibreEnd>;

export const FibreInst = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string().optional(),
  length_km: z.number().nonnegative().optional(),
  a: FibreEnd.default({}),
  b: FibreEnd.default({}),
  attenuation_dB_per_km: z.number().optional(),
  dispersion_ps_nm_km: z.number().optional(),
  extra_loss_dB: z.number().optional(),
  x: Ext.optional(),
});
export type FibreInst = z.infer<typeof FibreInst>;

export const XY = z.object({ x: z.number(), y: z.number() });
export const Rect = XY.extend({ w: z.number(), h: z.number() });
export const Layout = z.object({
  nodes: z.record(z.string(), XY).optional(),
  sites: z.record(z.string(), Rect).optional(),
  files: z.record(z.string(), Rect).optional(),
});
export type Layout = z.infer<typeof Layout>;

/** A fragment file: same shape as the parent minus `lumantite`, `includes`, `project`. */
export const FragmentFile = z.object({
  sites: z.array(Site).optional(),
  nodes: z.array(NodeInst).optional(),
  fibres: z.array(FibreInst).optional(),
  layout: Layout.optional(),
});
export type FragmentFile = z.infer<typeof FragmentFile>;

export const Include = z.object({ file: z.string(), label: z.string().optional() });
export type Include = z.infer<typeof Include>;

export const ProjectFile = FragmentFile.extend({
  lumantite: z.literal(1),
  includes: z.array(Include).optional(),
  project: ProjectMeta,
});
export type ProjectFile = z.infer<typeof ProjectFile>;

/** In-memory merged project: every element knows which file it came from. */
export interface ProjectModel {
  /** Path of the parent file, relative to the projects dir. */
  rootFile: string;
  /** All files: parent first, then includes in order. Paths relative to the parent's directory for includes. */
  files: { path: string; label?: string }[];
  project: ProjectMeta;
  sites: (Site & { file: string })[];
  nodes: (NodeInst & { file: string })[];
  fibres: (FibreInst & { file: string })[];
  layout: Layout;
}

/** Parse "node.port" | "fibre.a" | "fibre.b". Element ids may not contain '.'; ports may (e.g. mux port "C21.5"). */
export function parseEndpoint(to: string): { element: string; port: string } | null {
  const i = to.indexOf(".");
  if (i <= 0 || i === to.length - 1) return null;
  return { element: to.slice(0, i), port: to.slice(i + 1) };
}
