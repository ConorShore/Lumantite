import type { Channel, Check, Issue, Triple, WlSpec } from "@optiplanner/schema";
import type { Catalog } from "../catalog.js";

export type TermKind = "rx" | "dead_end" | "dropped" | "loop";

/** How a traced branch ends. */
export interface Term {
  kind: TermKind;
  rx?: { node: string; port: string };
  /** Check attached to the signal (non-rx terminations). */
  check?: Check;
  /** Where the issue is anchored (defaults to the tx node). */
  element?: string;
  port?: string;
  /** Do not emit an Issue for this termination (already reported elsewhere). */
  silent?: boolean;
}

export interface RouteSig {
  id: string;
  txNode: string;
  channel: Channel;
}

export interface RouteCtx {
  catalog: Catalog;
  /** Evaluate a WlSpec at λ; raises fibre.wavelength_out_of_table (once per element/channel) when λ is outside the table. */
  evalSpec(spec: WlSpec, nm: number, element: string, what: string, sig: RouteSig): Triple;
  issue(i: Issue, dedupeKey?: string): void;
}

/** One way a signal leaves a device. */
export interface RouteOut {
  /** Port the signal leaves on; absent when `term` is set. */
  outPort?: string;
  /** Positive dB loss, {min,typ,max} of the loss. */
  loss?: Triple;
  /** Dispersion added, ps/nm. */
  cd?: number;
  /** Gain is computed later by the amplifier stage. */
  amp?: boolean;
  note?: string;
  term?: Term;
}

export function failTerm(kind: TermKind, code: Check["code"], message: string, element: string, port?: string): Term {
  return { kind, element, port, check: { code, status: "fail", message } };
}
export function warnTerm(kind: TermKind, code: Check["code"], message: string, element: string, port?: string): Term {
  return { kind, element, port, check: { code, status: "warn", message } };
}
