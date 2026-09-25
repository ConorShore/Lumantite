/** Field suggestions per catalog kind, derived from the zod schemas (the "form generated from the class schema"). */
import {
  TransceiverModel, FibreModel, JointModel, MuxModel, AmplifierModel, AttenuatorModel, DcmModel,
  SplitterModel, PassthroughModel, HostModel, WavelengthPlan,
} from "@optiplanner/schema";
import type { Json } from "./ValueEditor";

const SCHEMAS: Record<string, { shape: Record<string, unknown> }> = {
  transceiver: TransceiverModel, fibre: FibreModel, joint: JointModel, mux: MuxModel, amplifier: AmplifierModel,
  attenuator: AttenuatorModel, dcm: DcmModel, splitter: SplitterModel, passthrough: PassthroughModel, host: HostModel,
  "wavelength-plan": WavelengthPlan,
};

interface ZDef { type: string; innerType?: unknown; options?: unknown[]; shape?: Record<string, unknown>; entries?: Record<string, string>; items?: unknown[]; values?: unknown[] }
const defOf = (s: unknown): ZDef | undefined => (s as { _zod?: { def?: ZDef } })?._zod?.def;

/** A reasonable empty value for a zod schema node. */
export function emptyFor(schema: unknown, depth = 0): Json {
  const d = defOf(schema);
  if (!d || depth > 4) return "";
  switch (d.type) {
    case "optional": case "nullable": case "default": case "prefault": return emptyFor(d.innerType, depth);
    case "number": return 0;
    case "string": return "";
    case "boolean": return false;
    case "literal": return (d.values?.[0] as Json) ?? "";
    case "enum": return Object.values(d.entries ?? {})[0] ?? "";
    case "array": return [];
    case "tuple": return (d.items ?? []).map((i) => emptyFor(i, depth + 1));
    case "union": return emptyFor(d.options?.[0], depth + 1);
    case "object": {
      const out: Record<string, Json> = {};
      for (const [k, v] of Object.entries(d.shape ?? {})) if (defOf(v)?.type !== "optional") out[k] = emptyFor(v, depth + 1);
      return out;
    }
    default: return {};
  }
}

export function fieldSuggestions(kind: string): { key: string; make(): Json }[] {
  const s = SCHEMAS[kind];
  if (!s) return [];
  return Object.entries(s.shape).filter(([k]) => !["kind", "id", "extends"].includes(k)).map(([key, schema]) => ({ key, make: () => emptyFor(schema) }));
}

export function requiredSkeleton(kind: string): Record<string, Json> {
  const s = SCHEMAS[kind];
  const out: Record<string, Json> = {};
  if (!s) return out;
  for (const [k, v] of Object.entries(s.shape)) if (!["kind", "id"].includes(k) && defOf(v)?.type !== "optional") out[k] = emptyFor(v);
  return out;
}
