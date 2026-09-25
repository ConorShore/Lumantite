/**
 * End-to-end CLI tests: run the CLI as a real child process (`npx tsx src/index.ts ...`) against
 * a temp project, exactly as a user would invoke it. No build step: tsx runs `src/index.ts`
 * directly against the bundled starter catalog (`@optiplanner/catalog`'s `catalogDir`, used
 * implicitly since no `-c/--catalog` flag is passed).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const cliDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A minimal single-file project: two `generic-10g-lr` transceivers, wired one-way (A tx -> B rx)
 * over two `lc-patch` jumpers and one `g652d` span. `spanKm` controls the span length (and so
 * whether the link budget passes).
 */
function projectYaml(spanKm: number): string {
  return `optiplanner: 1
project:
  name: CLI Smoke Test
  margins:
    system_margin_dB: 1.0
    ageing_dB: 0.5
    repair_splices: 0
    repair_splice_loss_dB: 0
    connector_ageing_dB: 0
    cd_margin_pct: 10
    max_channel_imbalance_dB: 6

sites:
  - { id: siteA, name: Site A }
  - { id: siteB, name: Site B }

nodes:
  - { id: A-sfp, model: generic-10g-lr, site: siteA }
  - { id: B-sfp, model: generic-10g-lr, site: siteB }

fibres:
  - id: p1
    type: lc-patch
    a: { to: A-sfp.tx }
    b: { to: span1.a }
  - id: span1
    type: g652d
    length_km: ${spanKm}
    a: { joint: lc-upc, to: p1.b }
    b: { joint: lc-upc, to: p2.a }
  - id: p2
    type: lc-patch
    a: { to: span1.b }
    b: { to: B-sfp.rx }
`;
}

interface CliResult { status: number; stdout: string }

function runCli(args: string[]): CliResult {
  try {
    const stdout = execFileSync("npx", ["tsx", "src/index.ts", ...args], { cwd: cliDir, encoding: "utf8" });
    return { status: 0, stdout };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "" };
  }
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "optiplanner-cli-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("optiplanner check", () => {
  it("exits 0 and prints PASS for a short (2 km) span", () => {
    const file = join(dir, "project.yaml");
    writeFileSync(file, projectYaml(2));
    const res = runCli(["check", file]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("PASS");
  }, 30000);

  it("exits 1 and reports rx.power_low for a long (100 km) span", () => {
    const file = join(dir, "project.yaml");
    writeFileSync(file, projectYaml(100));
    const res = runCli(["check", file]);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("rx.power_low");
  }, 30000);
});

describe("optiplanner export", () => {
  it("writes ports/signals CSV and a Markdown file with the expected headers", () => {
    const file = join(dir, "project.yaml");
    writeFileSync(file, projectYaml(2));
    const out = join(dir, "out");
    const res = runCli(["export", file, "-o", out]);
    expect(res.status).toBe(0);

    const base = "CLI_Smoke_Test";
    const ports = readFileSync(join(out, `${base}-ports.csv`), "utf8");
    const signals = readFileSync(join(out, `${base}-signals.csv`), "utf8");
    const md = readFileSync(join(out, `${base}.md`), "utf8");

    expect(ports.split(/\r?\n/)[0]).toBe(
      "row_type,node,port,direction,channel,plan,wavelength_nm,signal,power_min_dBm,power_typ_dBm,power_max_dBm,cd_ps_nm,port_total_min_dBm,port_total_typ_dBm,port_total_max_dBm,channel_count,status",
    );
    expect(signals.split(/\r?\n/)[0]).toBe(
      "signal,tx,rx,channel,plan,wavelength_nm,frequency_GHz,terminated,rx_power_min_dBm,rx_power_typ_dBm,rx_power_max_dBm,margin_sensitivity_dB,margin_overload_dB,cd_ps_nm,cd_tolerance_min_ps_nm,cd_tolerance_max_ps_nm,status",
    );
    expect(md.startsWith("# CLI Smoke Test — optical link budget")).toBe(true);
  }, 30000);
});
