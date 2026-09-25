import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the bundled starter catalog directory (SPEC.md §8.2). */
export const catalogDir: string = join(__dirname, "..", "catalog");

/** Absolute path to the bundled example projects directory. */
export const examplesDir: string = join(__dirname, "..", "examples");
