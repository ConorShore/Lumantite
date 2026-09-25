import { z } from "zod";

export const ChannelDef = z.object({
  id: z.string(),
  frequency_GHz: z.number().optional(),
  wavelength_nm: z.number().optional(),
  label: z.string().optional(),
}).refine((c) => c.frequency_GHz !== undefined || c.wavelength_nm !== undefined, {
  message: "channel needs frequency_GHz or wavelength_nm",
});
export type ChannelDef = z.infer<typeof ChannelDef>;

export const WavelengthPlan = z.object({
  kind: z.literal("wavelength-plan"),
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  source: z.string().optional(),
  /** Explicit channel list. Built-ins: cwdm-18, dwdm-c-100ghz-40, dwdm-c-50ghz-80. */
  channels: z.array(ChannelDef).min(1),
});
export type WavelengthPlan = z.infer<typeof WavelengthPlan>;

/** A resolved channel: both frequency and wavelength known. */
export interface Channel {
  plan: string;
  id: string;
  frequency_GHz: number;
  wavelength_nm: number;
  label?: string;
}
