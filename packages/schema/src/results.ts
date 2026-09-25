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
  | "imbalance.high";

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
  perChannel: { signalId: string; channel: Channel; gain: Triple; pin: Triple; pout: Triple }[];
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
