import { z } from "zod";
import { Margins } from "./project.js";

export const AppConfig = z.object({
  server: z.object({
    port: z.number().int().default(8080),
    host: z.string().default("0.0.0.0"),
  }).prefault({}),
  paths: z.object({
    projects: z.string().default("/data/projects"),
    catalog: z.string().default("/data/catalog"),
  }).prefault({}),
  defaults: z.object({
    wavelength_plan: z.string().default("dwdm-c-100ghz-40"),
    margins: Margins.prefault({}),
  }).prefault({}),
  ui: z.object({
    warn_threshold_dB: z.number().default(1.0),
    power_display: z.enum(["dBm", "mW"]).default("dBm"),
  }).prefault({}),
  export: z.object({
    csv_delimiter: z.string().default(","),
  }).prefault({}),
});
export type AppConfig = z.infer<typeof AppConfig>;
