import type { Triple } from "./common.js";
import type { Channel } from "./plans.js";
import type { AmpMode } from "./catalog.js";

export type Severity = "error" | "warn" | "info";
export type CheckStatus = "pass" | "warn" | "fail" | "n/a";

/** Stable machine-readable issue codes. UI and tests key on these. */
export type IssueCode =
  | "catalog.unknown_model" | "catalog.invalid_model" | "catalog.extends_cycle" | "catalog.unknown_plan" | "catalog.unknown_joint"
  | "project.duplicate_id" | "project.unknown_endpoint" | "project.unknown_port" | "project.endpoint_asymmetric"
  | "project.endpoint_reused" | "project.joint_family_mismatch" | "project.unknown_site" | "project.unknown_host"
  | "project.invalid_settings" | "project.file_unknown"
  | "project.parse_error" | "project.schema_error" | "project.invalid_op"
  | "topology.unterminated_tx" | "topology.rx_no_signal" | "topology.loop" | "topology.amplified_loop"
  | "topology.duplicate_channel" | "topology.direction_conflict"
  | "mux.wrong_channel" | "mux.channel_dropped"
  | "rx.power_low" | "rx.power_high" | "rx.wavelength" | "rx.cd"
  | "amp.input_low" | "amp.input_high" | "amp.output_saturated" | "amp.gain_clamped" | "amp.gain_out_of_range"
  | "amp.spectrum_extrapolated" | "amp.out_of_band" | "amp.mode_unsupported"
  | "fibre.power_high" | "fibre.wavelength_out_of_table"
  | "imbalance.high"
  // design rules, SPEC 7.10
  | "rx.multiple_signals" | "rx.power_damage" | "rx.osnr" | "rx.pmd" | "rx.reach"
  | "amp.channel_loading" | "amp.channel_input_low"
  | "mux.passband_exceeded" | "mux.crosstalk"
  | "fibre.channel_power_high" | "fibre.mode_mismatch" | "fibre.core_mismatch" | "fibre.type_mismatch"
  | "fibre.fwm_risk" | "fibre.water_peak" | "fibre.xpm_risk"
  | "joint.polish_mismatch" | "joint.reflection_risk"
  | "dcm.fibre_mismatch"
  | "safety.laser_class";

/** Indicative laser hazard class (SPEC 7.10 R13). */
export type LaserClass = "1" | "3R" | "3B" | "4";

export interface Issue {
  severity: Severity;
  code: IssueCode;
  /** Element id (node, fibre, signal) or file path the issue is anchored to. */
  element?: string;
  port?: string;
  channel?: string;
  message: string;
  values?: Record<string, number | string>;
}

export interface Check {
  code: IssueCode;
  status: CheckStatus;
  /** Positive = headroom, negative = violation, in the unit of the check (dB or ps/nm). */
  margin?: number;
  values?: Record<string, number | string>;
  message: string;
}

export interface PathStep {
  /** Node or fibre id, or "joint:<fibreA.end>~<fibreB.end>" for a fibre-to-fibre splice. */
  element: string;
  kind: string;
  /** Port entered / left (nodes) or "a"/"b" (fibres). */
  inPort?: string;
  outPort?: string;
  /** Change applied by this element, dB (negative = loss). */
  deltaPower: Triple;
  deltaCd: number;
  /** State after this element. */
  power: Triple;
  cd: number;
  note?: string;
}

export interface SignalResult {
  id: string;                 // `${txNode}.${txPort}:${channelId}`
  tx: { node: string; port: string };
  rx?: { node: string; port: string };
  channel: Channel;
  launch: Triple;
  path: PathStep[];
  powerAtEnd: Triple;
  cdAtEnd: number;
  /** ± CD uncertainty accumulated from fibre dispersion_uncertainty (SPEC 7.10 R9). */
  cdSpread: number;
  /** OSNR in 0.1 nm, dB; min = worst case. Absent when unamplified with an ideal Tx, or unknown (amp without NF). SPEC 7.10 R16. */
  osnr?: Triple;
  /** Mean DGD, ps (SPEC 7.10 R15). Absent when no fibre on the path has a PMD coefficient. */
  dgd_ps?: number;
  /** Σ fibre length on the path, km. */
  path_km: number;
  /** Channel-loading deltas at the end of the path (SPEC 7.10 R2); absent without amplifiers. */
  loading?: { full_dB: number; single_dB: number };
  terminated: "rx" | "dead_end" | "dropped" | "loop";
  checks: Check[];
  status: CheckStatus;
}

export interface PortChannelResult {
  signalId: string;
  channel: Channel;
  power: Triple;
  cd: number;
}

export interface PortResult {
  node: string;
  port: string;
  /** Signals leaving the port ("out") and entering it ("in"), tracked separately for bidi ports. */
  out: { channels: PortChannelResult[]; totalPower?: Triple };
  in: { channels: PortChannelResult[]; totalPower?: Triple };
  status: CheckStatus;
}

export interface FibreDirectionResult {
  /** "a>b" or "b>a" */
  direction: "a>b" | "b>a";
  channels: PortChannelResult[];   // power at launch (entering the fibre)
  totalPower?: Triple;
  /** Indicative laser hazard class of the aggregate launch power (SPEC 7.10 R13). */
  laserClass?: LaserClass;
  status: CheckStatus;
}

export interface FibreResult {
  id: string;
  length_km: number;
  loss: Triple;            // fibre only, excluding joints
  directions: FibreDirectionResult[];
  status: CheckStatus;
}

export interface AmplifierResult {
  id: string;
  mode: AmpMode;
  gainModel: "parametric" | "measured";
  pinTotal: Triple;
  poutTotal: Triple;
  gainEffective: Triple;
  headroom_dB: number;        // Pout_max − poutTotal.max
  perChannel: { signalId: string; channel: Channel; gain: Triple; pin: Triple; pout: Triple; osnrOut?: Triple }[];
  /** Channel-loading scenarios (SPEC 7.10 R2): per-channel gain change at full and single-channel load. */
  loading?: { designChannels: number; litChannels: number; full_dB: number; single_dB: number };
  imbalanceIn_dB?: number;    // typ, max−min over channels
  imbalanceOut_dB?: number;
  operatingPoints?: string;   // description of measured points used
  status: CheckStatus;
}

export interface Results {
  computedAt: string;
  signals: SignalResult[];
  ports: PortResult[];
  fibres: FibreResult[];
  amplifiers: AmplifierResult[];
  issues: Issue[];
  /** Worst status per element id (nodes and fibres) for canvas colouring. */
  elementStatus: Record<string, CheckStatus>;
  summary: { signals: number; pass: number; warn: number; fail: number; errors: number; warnings: number };
}
