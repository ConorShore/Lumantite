import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { CatalogEntry, ProjectFile, FragmentFile } from "@optiplanner/schema";
import { catalogDir, examplesDir } from "../src/index.js";

// ---------- helpers ----------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep-merge `extends` chains: child fields win. Arrays are replaced wholly, not concatenated. */
function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const existing = out[k];
    if (isPlainObject(v) && isPlainObject(existing)) {
      out[k] = deepMerge(existing, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function resolveExtends(id: string, byId: Map<string, Record<string, unknown>>, stack: string[] = []): Record<string, unknown> {
  const entry = byId.get(id);
  if (!entry) throw new Error(`unknown id referenced by extends: ${id}`);
  const parentId = entry.extends as string | undefined;
  if (!parentId) return entry;
  if (stack.includes(id)) throw new Error(`extends cycle: ${[...stack, id].join(" -> ")}`);
  const parent = resolveExtends(parentId, byId, [...stack, id]);
  const { extends: _drop, ...rest } = entry;
  return deepMerge(parent, rest);
}

function listYamlFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => join(dir, f));
}

/** Load every catalog file (each a top-level YAML sequence of loose entries). */
function loadRawCatalog(): { file: string; entry: Record<string, unknown> }[] {
  const out: { file: string; entry: Record<string, unknown> }[] = [];
  for (const file of listYamlFiles(catalogDir)) {
    const text = readFileSync(file, "utf8");
    const parsed = parseYaml(text);
    if (!Array.isArray(parsed)) {
      throw new Error(`${file}: expected a top-level YAML sequence`);
    }
    for (const entry of parsed) {
      out.push({ file, entry });
    }
  }
  return out;
}

// ---------- catalog: every file parses, every entry validates after extends resolution ----------

describe("catalog YAML", () => {
  const raw = loadRawCatalog();

  it("has at least one entry per catalog file", () => {
    expect(raw.length).toBeGreaterThan (0);
    const files = new Set(raw.map((r) => r.file));
    expect(files.size).toBe(listYamlFiles(catalogDir).length);
  });

  it("every entry has a unique kind+id", () => {
    const seen = new Set<string>();
    for (const { entry, file } of raw) {
      expect(typeof entry.kind, `${file}: missing kind`).toBe("string");
      expect(typeof entry.id, `${file}: missing id`).toBe("string");
      const key = `${entry.kind}:${entry.id}`;
      expect(seen.has(key), `duplicate ${key} (in ${file})`).toBe(false);
      seen.add(key);
    }
  });

  const byId = new Map<string, Record<string, unknown>>();
  for (const { entry } of raw) byId.set(entry.id as string, entry);

  it.each(raw.map((r) => [r.entry.id as string, r] as const))(
    "%s resolves (extends applied) and validates against CatalogEntry",
    (_id, { entry, file }) => {
      const resolved = resolveExtends(entry.id as string, byId);
      const result = CatalogEntry.safeParse(resolved);
      if (!result.success) {
        throw new Error(`${file} #${entry.id}: ${JSON.stringify(result.error.issues, null, 2)}`);
      }
    },
  );

  it("every joint connector referenced by a device model's `connector` field or ports exists", () => {
    const joints = new Set(raw.filter((r) => r.entry.kind === "joint").map((r) => r.entry.id as string));
    for (const { entry, file } of raw) {
      const resolved = resolveExtends(entry.id as string, byId);
      const conn = resolved.connector as string | undefined;
      if (conn) expect(joints.has(conn), `${file} #${entry.id}: unknown connector '${conn}'`).toBe(true);
      const ports = resolved.ports as Record<string, { connector?: string }> | undefined;
      if (ports) {
        for (const [portName, spec] of Object.entries(ports)) {
          if (spec.connector) {
            expect(joints.has(spec.connector), `${file} #${entry.id}.ports.${portName}: unknown connector '${spec.connector}'`).toBe(true);
          }
        }
      }
    }
  });

  it("every fibre's default_joint exists as a joint", () => {
    const joints = new Set(raw.filter((r) => r.entry.kind === "joint").map((r) => r.entry.id as string));
    for (const { entry, file } of raw) {
      if (entry.kind !== "fibre") continue;
      const resolved = resolveExtends(entry.id as string, byId);
      const dj = resolved.default_joint as string | undefined;
      if (dj) expect(joints.has(dj), `${file} #${entry.id}: unknown default_joint '${dj}'`).toBe(true);
    }
  });

  it("every transceiver/mux `plan` reference exists as a wavelength-plan", () => {
    const plans = new Set(raw.filter((r) => r.entry.kind === "wavelength-plan").map((r) => r.entry.id as string));
    for (const { entry, file } of raw) {
      if (entry.kind !== "transceiver" && entry.kind !== "mux") continue;
      const resolved = resolveExtends(entry.id as string, byId);
      const planIds: string[] = [];
      if (resolved.kind === "mux" && typeof resolved.plan === "string") planIds.push(resolved.plan);
      if (resolved.kind === "transceiver") {
        const tx = resolved.tx as { wavelength?: { plan?: string } } | undefined;
        if (tx?.wavelength?.plan) planIds.push(tx.wavelength.plan);
      }
      for (const p of planIds) expect(plans.has(p), `${file} #${entry.id}: unknown plan '${p}'`).toBe(true);
    }
  });
});

// ---------- wavelength plans: exact channel counts / grid ----------

describe("wavelength plans", () => {
  const raw = loadRawCatalog();
  const plans = new Map(raw.filter((r) => r.entry.kind === "wavelength-plan").map((r) => [r.entry.id as string, r.entry]));

  it("cwdm-18 has 18 channels, 1271..1611nm, 20nm spacing", () => {
    const p = plans.get("cwdm-18")!;
    const channels = p.channels as { id: string; wavelength_nm: number }[];
    expect(channels.length).toBe(18);
    expect(channels[0].wavelength_nm).toBe(1271);
    expect(channels[channels.length - 1].wavelength_nm).toBe(1611);
    for (let i = 1; i < channels.length; i++) {
      expect(channels[i].wavelength_nm - channels[i - 1].wavelength_nm).toBe(20);
    }
  });

  it("dwdm-c-100ghz-40 has 40 channels C21..C60, 192100..196000 GHz", () => {
    const p = plans.get("dwdm-c-100ghz-40")!;
    const channels = p.channels as { id: string; frequency_GHz: number; wavelength_nm: number }[];
    expect(channels.length).toBe(40);
    expect(channels[0].id).toBe("C21");
    expect(channels[0].frequency_GHz).toBe(192100);
    expect(channels[channels.length - 1].id).toBe("C60");
    expect(channels[channels.length - 1].frequency_GHz).toBe(196000);
    // lambda = c / f
    const c21 = channels[0];
    expect(c21.wavelength_nm).toBeCloseTo(299792458 / c21.frequency_GHz, 3);
  });

  it("dwdm-c-50ghz-80 has 80 channels C21..C60.5, 192100..196050 GHz", () => {
    const p = plans.get("dwdm-c-50ghz-80")!;
    const channels = p.channels as { id: string; frequency_GHz: number }[];
    expect(channels.length).toBe(80);
    expect(channels[0].id).toBe("C21");
    expect(channels[1].id).toBe("C21.5");
    expect(channels[2].id).toBe("C22");
    expect(channels[channels.length - 1].id).toBe("C60.5");
    expect(channels[channels.length - 1].frequency_GHz).toBe(196050);
  });
});

// ---------- examples: parse and validate against ProjectFile / FragmentFile ----------

function listExampleDirs(): string[] {
  return readdirSync(examplesDir).filter((f) => statSync(join(examplesDir, f)).isDirectory());
}

function walkYamlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walkYamlFiles(p));
    else if (f.endsWith(".yaml") || f.endsWith(".yml")) out.push(p);
  }
  return out;
}

describe("example projects", () => {
  const dirs = listExampleDirs();

  it("has at least the three required examples", () => {
    expect(dirs).toEqual(expect.arrayContaining(["simple-link", "dwdm-amplified", "cwdm-ring"]));
  });

  for (const dir of dirs) {
    describe(dir, () => {
      const root = join(examplesDir, dir);
      const rootFile = join(root, "project.yaml");

      it("project.yaml validates against ProjectFile", () => {
        const text = readFileSync(rootFile, "utf8");
        const parsed = parseYaml(text);
        const result = ProjectFile.safeParse(parsed);
        if (!result.success) {
          throw new Error(`${rootFile}: ${JSON.stringify(result.error.issues, null, 2)}`);
        }
      });

      it("every fragment file validates against FragmentFile", () => {
        const text = readFileSync(rootFile, "utf8");
        const parsed = ProjectFile.parse(parseYaml(text));
        for (const inc of parsed.includes ?? []) {
          const fragPath = join(root, inc.file);
          const fragText = readFileSync(fragPath, "utf8");
          const fragParsed = parseYaml(fragText);
          const result = FragmentFile.safeParse(fragParsed);
          if (!result.success) {
            throw new Error(`${fragPath}: ${JSON.stringify(result.error.issues, null, 2)}`);
          }
        }
      });

      it("every yaml file under the example directory is either the root or a listed include", () => {
        const text = readFileSync(rootFile, "utf8");
        const parsed = ProjectFile.parse(parseYaml(text));
        const included = new Set((parsed.includes ?? []).map((i) => join(root, i.file)));
        const all = walkYamlFiles(root);
        for (const f of all) {
          if (f === rootFile) continue;
          expect(included.has(f), `${f} is not listed under includes:`).toBe(true);
        }
      });

      it("every node.model and fibre.type referenced resolves to a catalog entry", () => {
        const catalogRaw = loadRawCatalog();
        const ids = new Set(catalogRaw.map((r) => r.entry.id as string));
        const text = readFileSync(rootFile, "utf8");
        const parsed = ProjectFile.parse(parseYaml(text));
        const files = [parsed, ...((parsed.includes ?? []).map((inc) => FragmentFile.parse(parseYaml(readFileSync(join(root, inc.file), "utf8")))))];
        for (const f of files) {
          for (const n of f.nodes ?? []) {
            expect(ids.has(n.model), `node ${n.id}: unknown model '${n.model}'`).toBe(true);
          }
          for (const fib of f.fibres ?? []) {
            expect(ids.has(fib.type), `fibre ${fib.id}: unknown type '${fib.type}'`).toBe(true);
          }
        }
      });
    });
  }
});
