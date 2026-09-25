// Generates catalog/transceivers-fs.yaml from the FS.com datasheet rows in data/fs/*.yaml.
// Run with: npx tsx packages/catalog/scripts/gen-fs-transceivers.ts
//
// Row format: data/fs/README.md. Each row becomes one transceiver model, except fixed-channel
// WDM families (channels.tunable: false), which become one "family" model whose channel is
// chosen per instance plus one fixed-wavelength model per channel FS sells.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Document, isScalar, isSeq, parse as parseYaml, visit } from "yaml";
import { TransceiverModel } from "@lumantite/schema";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data", "fs");
const PLANS_FILE = join(__dirname, "..", "catalog", "wavelength-plans.yaml");
const OUT_FILE = join(__dirname, "..", "catalog", "transceivers-fs.yaml");

type Range = { min?: number; typ?: number; max?: number };
interface Row {
  pn: string;
  id?: string;
  fs_products?: number[];
  title: string;
  form_factor: string;
  rate_Gbps: number;
  reach_km: number;
  media: "smf" | "mmf";
  connector: string;
  temp: "commercial" | "industrial";
  wavelength_nm?: number;
  bidi?: { tx_nm: number; rx_nm: number };
  channels?: { plan: string; ids: string[]; tunable: boolean };
  tx_power_dBm: Range;
  rx_sensitivity_dBm: number;
  rx_overload_dBm: number;
  rx_range_nm?: [number, number];
  cd_tolerance_ps_nm?: number | { min: number; max: number };
  source: string;
  verified: boolean;
  notes?: string;
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

// ---------- load plans (channel ids per plan, for validation and "all") ----------
const planChannels = new Map<string, string[]>();
for (const p of parseYaml(readFileSync(PLANS_FILE, "utf8")) as { id: string; channels: { id: string }[] }[]) {
  planChannels.set(p.id, p.channels.map((c) => String(c.id)));
}

// ---------- load rows ----------
const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".yaml")).sort();
const errors: string[] = [];
const entries: { file: string; models: Record<string, unknown>[] }[] = [];
const seenIds = new Set<string>();
const seenPns = new Set<string>();

function claimId(id: string, where: string) {
  if (seenIds.has(id)) errors.push(`${where}: duplicate id ${id}`);
  seenIds.add(id);
}

/** FS's nominal label for a channel: CWDM by pre-G.694.2 nm (1271 -> 1270nm), DWDM as-is. */
function fsChannelLabel(plan: string, ch: string): string {
  return plan.startsWith("cwdm") ? `${Number(ch) - 1}nm` : ch;
}

function model(row: Row, id: string, wavelength: unknown, extra: { model?: string; description?: string } = {}) {
  const connector = row.connector;
  const x: Record<string, unknown> = { media: row.media, temp: row.temp };
  if (row.fs_products?.length) x.fs_products = row.fs_products;
  if (row.notes) x.notes = row.notes;
  const rx: Record<string, unknown> = { sensitivity_dBm: row.rx_sensitivity_dBm, overload_dBm: row.rx_overload_dBm };
  if (row.cd_tolerance_ps_nm !== undefined) rx.cd_tolerance_ps_nm = row.cd_tolerance_ps_nm;
  if (row.rx_range_nm) rx.wavelength_range_nm = row.rx_range_nm;
  return {
    kind: "transceiver",
    id,
    vendor: "FS",
    model: extra.model ?? row.pn,
    description: extra.description ?? `${row.title}${row.temp === "industrial" ? " (industrial temp)" : ""}`,
    form_factor: row.form_factor,
    rate_Gbps: row.rate_Gbps,
    reach_km: row.reach_km,
    tx: { wavelength, power_dBm: row.tx_power_dBm },
    rx,
    ports: row.bidi
      ? { bidi: { direction: "bidi", connector } }
      : { tx: { direction: "out", connector }, rx: { direction: "in", connector } },
    source: row.source,
    x,
  };
}

for (const file of files) {
  const rows = parseYaml(readFileSync(join(DATA_DIR, file), "utf8")) as Row[] | null;
  if (!rows) continue;
  const models: Record<string, unknown>[] = [];
  for (const row of rows) {
    const where = `${file} ${row.pn}`;
    if (row.verified !== true) { errors.push(`${where}: unverified rows are not allowed — move it to data/fs/excluded/ (see data/fs/README.md)`); continue; }
    if (seenPns.has(row.pn)) errors.push(`${where}: duplicate pn`);
    seenPns.add(row.pn);
    const forms = [row.wavelength_nm !== undefined, !!row.bidi, !!row.channels].filter(Boolean).length;
    if (forms !== 1) { errors.push(`${where}: needs exactly one of wavelength_nm / bidi / channels`); continue; }
    const id = row.id ?? `fs-${slug(row.pn)}`;

    if (row.wavelength_nm !== undefined) {
      claimId(id, where);
      models.push(model(row, id, { wavelength_nm: row.wavelength_nm }));
    } else if (row.bidi) {
      claimId(id, where);
      models.push(model(row, id, { wavelength_nm: row.bidi.tx_nm }, {
        description: `${row.title}, BiDi Tx ${row.bidi.tx_nm}nm / Rx ${row.bidi.rx_nm}nm${row.temp === "industrial" ? " (industrial temp)" : ""}`,
      }));
    } else if (row.channels) {
      const { plan, ids, tunable } = row.channels;
      const known = planChannels.get(plan);
      if (!known) { errors.push(`${where}: unknown plan ${plan}`); continue; }
      const bad = ids.filter((c) => !known.includes(String(c)));
      if (bad.length) { errors.push(`${where}: channels not in ${plan}: ${bad.join(", ")}`); continue; }
      const chIds = ids.map(String);
      const all = chIds.length === known.length && known.every((c) => chIds.includes(c));
      const suffix = row.temp === "industrial" ? " (industrial temp)" : "";
      claimId(id, where);
      models.push(model(row, id, { plan, channels: all ? "all" : chIds }, {
        description: tunable
          ? `${row.title}, tunable across ${chIds.length} channels${suffix}`
          : `${row.title}, any of ${chIds.length} channels — pick the channel per instance; FS sells one fixed-wavelength SKU per channel (see ${id}-<channel>)${suffix}`,
      }));
      if (!tunable) {
        for (const ch of chIds) {
          const chId = `${id}-${slug(ch)}`;
          claimId(chId, where);
          const label = fsChannelLabel(plan, ch);
          models.push(model(row, chId, { plan, channel: ch }, {
            model: `${row.pn} ${label}`,
            description: `${row.title}, ${label} fixed${suffix}`,
          }));
        }
      }
    }
  }
  entries.push({ file, models });
}

// ---------- validate every generated model against the schema ----------
for (const { models } of entries) {
  for (const m of models) {
    const r = TransceiverModel.safeParse(m);
    if (!r.success) errors.push(`${m.id}: ${JSON.stringify(r.error.issues)}`);
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

// ---------- write ----------
let out = `# GENERATED FILE — do not hand-edit. Regenerate with:
#   npx tsx packages/catalog/scripts/gen-fs-transceivers.ts
#
# FS.com 100M / 1G / 10G SFP and SFP+ optics (SPEC.md §5.1), generated from the datasheet rows
# in data/fs/*.yaml — see data/fs/README.md for sources and conventions. Every value was read
# from an FS datasheet; parts whose FS sources disagree are left out (data/fs/excluded/).
`;
let total = 0;
for (const { file, models } of entries) {
  total += models.length;
  out += `\n# ==================== data/fs/${file} (${models.length} models) ====================\n\n`;
  // Scalar-only maps/sequences (ranges, ports, wavelength) in flow style, like the hand-written catalog.
  const doc = new Document(models, { aliasDuplicateObjects: false });
  visit(doc, {
    Map(_, node, path) {
      if (path.length > 2 && node.items.every((p) => isScalar(p.value) || (isSeq(p.value) && p.value.items.every(isScalar)))) node.flow = true;
    },
    Seq(_, node, path) {
      if (path.length > 2 && node.items.every(isScalar)) node.flow = true;
    },
  });
  out += doc.toString({ lineWidth: 0, flowCollectionPadding: true }) + "\n";
}
writeFileSync(OUT_FILE, out, "utf8");
console.log(`wrote ${OUT_FILE}: ${total} models from ${files.length} files`);
