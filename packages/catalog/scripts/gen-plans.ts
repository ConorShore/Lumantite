// Generates catalog/wavelength-plans.yaml from the rules in SPEC.md §4.6.
// Run with: npx tsx packages/catalog/scripts/gen-plans.ts
//
// cwdm-18:            1271 .. 1611 nm, 20 nm spacing (ITU-T G.694.2), ids are the nominal nm.
// dwdm-c-100ghz-40:   C21 .. C60 = 192100 .. 196000 GHz, 100 GHz spacing (ITU-T G.694.1).
// dwdm-c-50ghz-80:    192100 .. 196050 GHz, 50 GHz spacing; ids C21, C21.5, C22 ... C60, C60.5.
//
// Frequency (GHz) is canonical for DWDM; wavelength_nm is derived with c = 299 792 458 m/s
// and rounded to 3 decimals: wavelength_nm = 299792458 / frequency_GHz.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ghzToNm } from "@optiplanner/schema";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, "..", "catalog", "wavelength-plans.yaml");

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------- cwdm-18 ----------
const cwdmChannels: string[] = [];
for (let i = 0; i < 18; i++) {
  const nm = 1271 + 20 * i;
  cwdmChannels.push(
    `  - { id: "${nm}", wavelength_nm: ${nm}, label: "${nm} nm" }`,
  );
}

// ---------- dwdm-c-100ghz-40 ----------
const dwdm40Channels: string[] = [];
for (let i = 0; i < 40; i++) {
  const freq = 192100 + 100 * i;
  const id = `C${21 + i}`;
  const nm = round3(ghzToNm(freq));
  dwdm40Channels.push(
    `  - { id: ${id}, frequency_GHz: ${freq}, wavelength_nm: ${nm.toFixed(3)}, label: "${id} (${(freq / 1000).toFixed(2)} THz)" }`,
  );
}

// ---------- dwdm-c-50ghz-80 ----------
const dwdm80Channels: string[] = [];
for (let i = 0; i < 80; i++) {
  const freq = 192100 + 50 * i;
  const base = 21 + Math.floor(i / 2);
  const half = i % 2 === 1;
  const id = half ? `C${base}.5` : `C${base}`;
  const nm = round3(ghzToNm(freq));
  dwdm80Channels.push(
    `  - { id: "${id}", frequency_GHz: ${freq}, wavelength_nm: ${nm.toFixed(3)}, label: "${id} (${(freq / 1000).toFixed(3)} THz)" }`,
  );
}

const out = `# GENERATED FILE — do not hand-edit. Regenerate with:
#   npx tsx packages/catalog/scripts/gen-plans.ts
#
# Built-in wavelength plans (SPEC.md §4.6). Frequency in GHz is canonical for DWDM;
# wavelength_nm is derived with c = 299 792 458 m/s and rounded to 3 decimals.
# CWDM channels are defined by nominal wavelength (ITU-T G.694.2) so only wavelength_nm is given.

- kind: wavelength-plan
  id: cwdm-18
  name: CWDM 18-channel
  description: ITU-T G.694.2 coarse WDM grid, 1271-1611 nm, 20 nm spacing.
  source: "ITU-T G.694.2 (2003), Table 1 — CWDM wavelength grid"
  channels:
${cwdmChannels.join("\n")}

- kind: wavelength-plan
  id: dwdm-c-100ghz-40
  name: DWDM C-band 100 GHz (40 channels)
  description: ITU-T G.694.1 fixed DWDM grid, C-band, 100 GHz spacing, C21-C60 (192.1-196.0 THz).
  source: "ITU-T G.694.1 (2020), Table 1 — 100 GHz nominal central frequency grid"
  channels:
${dwdm40Channels.join("\n")}

- kind: wavelength-plan
  id: dwdm-c-50ghz-80
  name: DWDM C-band 50 GHz (80 channels)
  description: ITU-T G.694.1 fixed DWDM grid, C-band, 50 GHz spacing, C21-C60.5 (192.10-196.05 THz).
  source: "ITU-T G.694.1 (2020), Table 1 — 50 GHz nominal central frequency grid"
  channels:
${dwdm80Channels.join("\n")}
`;

writeFileSync(OUT_FILE, out, "utf8");
console.log(`wrote ${OUT_FILE}`);
console.log(`  cwdm-18: ${cwdmChannels.length} channels`);
console.log(`  dwdm-c-100ghz-40: ${dwdm40Channels.length} channels`);
console.log(`  dwdm-c-50ghz-80: ${dwdm80Channels.length} channels`);
