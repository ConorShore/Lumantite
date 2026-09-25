import { AppConfig } from "@lumantite/schema";
import { parse as parseYaml } from "yaml";
import { readFileIfExists } from "./files.js";

/**
 * Resolve the application config: `LUMANTITE_CONFIG` env var, then `/config.yaml`, then
 * `./config.yaml`, then schema defaults. The first candidate path that exists on disk wins;
 * its content is parsed as YAML and validated (with defaults filled) through `AppConfig`.
 */
export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<AppConfig> {
  const candidates = [env.LUMANTITE_CONFIG, "/config.yaml", "./config.yaml"].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );

  for (const candidate of candidates) {
    const text = await readFileIfExists(candidate);
    if (text === undefined) continue;
    const raw = parseYaml(text) ?? {};
    return AppConfig.parse(raw);
  }

  return AppConfig.parse({});
}
