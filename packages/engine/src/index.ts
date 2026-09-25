/**
 * @optiplanner/engine — pure physics, propagation, checks and exports (SPEC §4, §5, §7, §10).
 * No I/O, no DOM. See docs/CONTRACT.md for the public API.
 */
export { resolveCatalog, portsOf, type Catalog } from "./catalog.js";
export { validate } from "./validate.js";
export { compute, type ComputeOptions, DEFAULT_FIBRE_MAX_POWER_DBM, FIBRE_LOSS_REFERENCE_NM } from "./compute.js";
export { toPortsCsv, toSignalsCsv, toMarkdown } from "./exports.js";
export { resolveMargins } from "./checks.js";
export {
  dbmToMw,
  mwToDbm,
  sumDbm,
  resolveTriple,
  interp,
  inTableRange,
  attenuationAt,
  dispersionAt,
  applyLoss,
  applyGain,
  lossToDelta,
  fillRange3,
} from "./physics.js";
