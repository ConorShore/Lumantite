/** JSON Schemas for the YAML editor, generated from the zod schemas in @optiplanner/schema. */
import { z } from "zod";
import { ProjectFile, FragmentFile } from "@optiplanner/schema";

type JsonSchema = Record<string, unknown>;
let cache: { project: JsonSchema; fragment: JsonSchema } | null = null;

export function projectJsonSchemas(): { project: JsonSchema; fragment: JsonSchema } {
  if (!cache) {
    const opts = { io: "input", unrepresentable: "any", target: "draft-7" } as const;
    cache = {
      project: z.toJSONSchema(ProjectFile, opts) as JsonSchema,
      fragment: z.toJSONSchema(FragmentFile, opts) as JsonSchema,
    };
  }
  return cache;
}
