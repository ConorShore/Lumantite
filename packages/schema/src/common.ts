import { z } from "zod";

/** {min, typ, max} triple. Any member may be omitted; the engine fills gaps (typ ← min/max, min/max ← typ). */
export const Range3 = z.object({
  min: z.number().optional(),
  typ: z.number().optional(),
  max: z.number().optional(),
});
export type Range3 = z.infer<typeof Range3>;

/** A scalar (min = typ = max) or a Range3. */
export const NumOrRange = z.union([z.number(), Range3]);
export type NumOrRange = z.infer<typeof NumOrRange>;

/** One row of a wavelength-dependent table. */
export const WlRow = z.object({ nm: z.number(), value: NumOrRange });
export type WlRow = z.infer<typeof WlRow>;

/** Scalar, Range3, or a wavelength table of scalars/Range3s (linear interpolation in nm). */
export const WlSpec = z.union([z.number(), Range3, z.array(WlRow).min(1)]);
export type WlSpec = z.infer<typeof WlSpec>;

/** Fully-resolved triple used everywhere inside the engine. */
export interface Triple { min: number; typ: number; max: number }

/** Free-form extension map (`x:`) reserved for parameters not yet in the schema. */
export const Ext = z.record(z.string(), z.unknown());
export type Ext = z.infer<typeof Ext>;

export const Direction = z.enum(["in", "out", "bidi"]);
export type Direction = z.infer<typeof Direction>;

export const PortSpec = z.object({
  direction: Direction,
  /** Joint model id (e.g. `lc-upc`) describing what plugs in. Family must match the fibre end's joint. */
  connector: z.string().optional(),
  /** Channel restriction (mux channel ports). */
  channel: z.string().optional(),
  label: z.string().optional(),
});
export type PortSpec = z.infer<typeof PortSpec>;
export const Ports = z.record(z.string(), PortSpec);
export type Ports = z.infer<typeof Ports>;

export const SPEED_OF_LIGHT_KM_S = 299_792.458;
/** Frequency in GHz → vacuum wavelength in nm. */
export const ghzToNm = (ghz: number): number => (SPEED_OF_LIGHT_KM_S * 1e3) / ghz;
/** Vacuum wavelength in nm → frequency in GHz. */
export const nmToGhz = (nm: number): number => (SPEED_OF_LIGHT_KM_S * 1e3) / nm;
