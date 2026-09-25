import { promises as fs } from "node:fs";
import type { FastifyBaseLogger } from "fastify";
import { isDirEmpty, pathExists } from "./files.js";

interface CatalogModule {
  catalogDir?: string;
  examplesDir?: string;
}

// `@optiplanner/catalog` is built concurrently by another agent and may not have compiled
// output/types yet. Import it via a non-literal specifier so TypeScript does not try to
// statically resolve its types at build time; the try/catch handles it being absent at runtime.
const CATALOG_PACKAGE = "@optiplanner/catalog";

async function loadCatalogModule(log: FastifyBaseLogger): Promise<CatalogModule | undefined> {
  try {
    const mod = (await import(CATALOG_PACKAGE)) as CatalogModule;
    return mod;
  } catch (err) {
    log.warn({ err }, "@optiplanner/catalog is not available yet; skipping starter-content bootstrap for it");
    return undefined;
  }
}

async function copyStarterContent(targetDir: string, sourceDir: string | undefined, label: string, log: FastifyBaseLogger): Promise<void> {
  const empty = await isDirEmpty(targetDir);
  if (!empty) {
    log.info(`${label}: ${targetDir} already has content, leaving it as-is`);
    return;
  }
  if (!sourceDir || !(await pathExists(sourceDir))) {
    log.warn(`${label}: no starter source available; ${targetDir} stays empty`);
    return;
  }
  await fs.mkdir(targetDir, { recursive: true });
  await fs.cp(sourceDir, targetDir, { recursive: true });
  log.info(`${label}: copied starter content from ${sourceDir} to ${targetDir}`);
}

/**
 * If `paths.catalog` / `paths.projects` are empty (or missing) at startup, seed them from
 * `@optiplanner/catalog`'s bundled `catalogDir` / `examplesDir`. That package is built
 * concurrently, so a missing/incomplete export only logs a warning.
 */
export async function bootstrapStarterContent(
  paths: { catalog: string; projects: string },
  log: FastifyBaseLogger,
): Promise<void> {
  const mod = await loadCatalogModule(log);
  await copyStarterContent(paths.catalog, mod?.catalogDir, "starter catalog", log);
  await copyStarterContent(paths.projects, mod?.examplesDir, "example projects", log);
}
