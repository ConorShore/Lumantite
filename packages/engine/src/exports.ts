import type { Check, ProjectModel, Results, Triple } from "@lumantite/schema";

const EOL = "\r\n";

function num(v: number | undefined, digits = 2): string {
  if (v === undefined || !Number.isFinite(v)) return "";
  const s = v.toFixed(digits);
  return s === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : s;
}

/** RFC 4180 field quoting. */
function field(v: string | number | undefined, delimiter: string): string {
  const s = v === undefined ? "" : String(v);
  if (s.includes(delimiter) || s.includes('"') || s.includes("\n") || s.includes("\r")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csv(rows: (string | number | undefined)[][], delimiter: string): string {
  return rows.map((r) => r.map((c) => field(c, delimiter)).join(delimiter)).join(EOL) + EOL;
}

/**
 * Ports CSV (SPEC §10): one row per (node, port, direction, channel) with power min/typ/max, CD,
 * total port power in that direction and worst port status; plus one summary row per port
 * (row_type "port") with the number of distinct channels in either direction.
 */
export function toPortsCsv(results: Results, delimiter = ","): string {
  const rows: (string | number | undefined)[][] = [
    [
      "row_type", "node", "port", "direction", "channel", "plan", "wavelength_nm", "signal",
      "power_min_dBm", "power_typ_dBm", "power_max_dBm", "cd_ps_nm",
      "port_total_min_dBm", "port_total_typ_dBm", "port_total_max_dBm", "channel_count", "status",
    ],
  ];
  for (const p of results.ports) {
    const distinct = new Set<string>();
    for (const dir of ["out", "in"] as const) {
      const d = p[dir];
      for (const c of d.channels) {
        distinct.add(`${c.channel.plan}:${c.channel.id}`);
        rows.push([
          "channel", p.node, p.port, dir, c.channel.id, c.channel.plan, num(c.channel.wavelength_nm, 2), c.signalId,
          num(c.power.min), num(c.power.typ), num(c.power.max), num(c.cd),
          num(d.totalPower?.min), num(d.totalPower?.typ), num(d.totalPower?.max), d.channels.length, p.status,
        ]);
      }
    }
    rows.push(["port", p.node, p.port, "", "", "", "", "", "", "", "", "", "", "", "", distinct.size, p.status]);
  }
  return csv(rows, delimiter);
}

function checkOf(checks: Check[], code: Check["code"]): Check | undefined {
  return checks.find((c) => c.code === code);
}

/** Signals CSV (SPEC §10): one row per signal. */
export function toSignalsCsv(results: Results, delimiter = ","): string {
  const rows: (string | number | undefined)[][] = [
    [
      "signal", "tx", "rx", "channel", "plan", "wavelength_nm", "frequency_GHz", "terminated",
      "rx_power_min_dBm", "rx_power_typ_dBm", "rx_power_max_dBm",
      "margin_sensitivity_dB", "margin_overload_dB", "cd_ps_nm", "cd_tolerance_min_ps_nm", "cd_tolerance_max_ps_nm",
      "cd_spread_ps_nm", "osnr_min_dB", "osnr_typ_dB", "margin_osnr_dB", "dgd_ps", "path_km", "status",
    ],
  ];
  for (const s of results.signals) {
    const low = checkOf(s.checks, "rx.power_low");
    const high = checkOf(s.checks, "rx.power_high");
    const cd = checkOf(s.checks, "rx.cd");
    const osnr = checkOf(s.checks, "rx.osnr");
    const atRx = s.terminated === "rx";
    rows.push([
      s.id,
      `${s.tx.node}.${s.tx.port}`,
      s.rx ? `${s.rx.node}.${s.rx.port}` : "",
      s.channel.id,
      s.channel.plan,
      num(s.channel.wavelength_nm, 2),
      num(s.channel.frequency_GHz, 1),
      s.terminated,
      atRx ? num(s.powerAtEnd.min) : "",
      atRx ? num(s.powerAtEnd.typ) : "",
      atRx ? num(s.powerAtEnd.max) : "",
      num(low?.margin),
      num(high?.margin),
      num(s.cdAtEnd),
      cd ? num(Number(cd.values?.tolerance_min), 0) : "",
      cd ? num(Number(cd.values?.tolerance_max), 0) : "",
      num(s.cdSpread, 1),
      num(s.osnr?.min),
      num(s.osnr?.typ),
      num(osnr?.margin),
      num(s.dgd_ps),
      num(s.path_km, 3),
      s.status,
    ]);
  }
  return csv(rows, delimiter);
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

function cell(s: string | number | undefined): string {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function t3(t: Triple | undefined, digits = 2): string {
  if (!t) return "";
  return `${num(t.min, digits)} / ${num(t.typ, digits)} / ${num(t.max, digits)}`;
}

function table(head: string[], rows: (string | number | undefined)[][]): string {
  const out = [`| ${head.map(cell).join(" | ")} |`, `|${head.map(() => "---").join("|")}|`];
  for (const r of rows) out.push(`| ${r.map(cell).join(" | ")} |`);
  return out.join("\n");
}

/** Markdown report: project summary, per-signal link budget tables, amplifier table, issues. */
export function toMarkdown(model: ProjectModel, results: Results): string {
  const md: string[] = [];
  const p = model.project;
  md.push(`# ${p?.name ?? model.rootFile} — optical link budget`);
  md.push("");
  if (p?.description) md.push(p.description, "");
  const s = results.summary;
  md.push("## Summary", "");
  md.push(
    table(
      ["Item", "Value"],
      [
        ["Project file", model.rootFile],
        ["Files", model.files?.length ?? 1],
        ["Nodes", model.nodes?.length ?? 0],
        ["Fibres", model.fibres?.length ?? 0],
        ["Signals", `${s.signals} (pass ${s.pass}, warn ${s.warn}, fail ${s.fail})`],
        ["Issues", `${s.errors} errors, ${s.warnings} warnings`],
        ["Computed", results.computedAt],
      ],
    ),
  );
  md.push("");
  if (p?.margins && Object.keys(p.margins).length) {
    md.push("### Project margins", "");
    md.push(table(["Margin", "Value"], Object.entries(p.margins).map(([k, v]) => [k, v as number])));
    md.push("");
  }

  md.push("## Signals", "");
  if (!results.signals.length) md.push("_No signals._", "");
  for (const sig of results.signals) {
    const ch = sig.channel;
    md.push(`### ${sig.id} — ${sig.status.toUpperCase()}`, "");
    md.push(
      `Tx \`${sig.tx.node}.${sig.tx.port}\` → ${sig.rx ? `Rx \`${sig.rx.node}.${sig.rx.port}\`` : `_${sig.terminated}_`} · ` +
        `channel ${ch.id} (${ch.plan}, ${ch.wavelength_nm.toFixed(2)} nm) · launch ${t3(sig.launch)} dBm · ` +
        `end ${t3(sig.powerAtEnd)} dBm · CD ${num(sig.cdAtEnd, 1)}${sig.cdSpread ? ` ± ${num(sig.cdSpread, 1)}` : ""} ps/nm · ${num(sig.path_km, 1)} km` +
        (sig.osnr ? ` · OSNR ${t3(sig.osnr)} dB` : "") +
        (sig.dgd_ps !== undefined ? ` · DGD ${num(sig.dgd_ps)} ps` : ""),
    );
    md.push("");
    md.push(
      table(
        ["Element", "Kind", "Δ min / typ / max (dB)", "Cumulative min / typ / max (dBm)", "CD (ps/nm)"],
        sig.path.map((st) => [
          `${st.element}${st.inPort || st.outPort ? ` (${st.inPort ?? ""}→${st.outPort ?? ""})` : ""}${st.note ? ` ${st.note}` : ""}`,
          st.kind,
          t3(st.deltaPower),
          t3(st.power),
          num(st.cd, 1),
        ]),
      ),
    );
    md.push("");
    if (sig.checks.length) {
      md.push(
        table(
          ["Check", "Status", "Margin", "Detail"],
          sig.checks.map((c) => [c.code, c.status, c.margin === undefined ? "" : num(c.margin), c.message]),
        ),
      );
      md.push("");
    }
  }

  md.push("## Amplifiers", "");
  if (!results.amplifiers.length) md.push("_No amplifiers carry traffic._", "");
  else {
    md.push(
      table(
        ["Amplifier", "Mode", "Gain model", "Pin total (dBm)", "Gain eff (dB)", "Pout total (dBm)", "Headroom (dB)", "Imbalance in / out (dB)", "Status"],
        results.amplifiers.map((a) => [
          a.id,
          a.mode,
          a.gainModel,
          t3(a.pinTotal),
          t3(a.gainEffective),
          t3(a.poutTotal),
          num(a.headroom_dB),
          a.imbalanceIn_dB === undefined ? "" : `${num(a.imbalanceIn_dB)} / ${num(a.imbalanceOut_dB)}`,
          a.status,
        ]),
      ),
    );
    md.push("");
    for (const a of results.amplifiers) {
      md.push(`#### ${a.id} per channel${a.operatingPoints ? ` (${a.operatingPoints})` : ""}`, "");
      if (a.loading)
        md.push(
          `Channel loading: ${a.loading.litChannels} lit of ${a.loading.designChannels} design · ΔG full ${num(a.loading.full_dB)} dB · single ${num(a.loading.single_dB)} dB`,
          "",
        );
      md.push(
        table(
          ["Signal", "Channel", "Pin (dBm)", "Gain (dB)", "Pout (dBm)", "OSNR out (dB)"],
          a.perChannel.map((c) => [c.signalId, c.channel.id, t3(c.pin), t3(c.gain), t3(c.pout), t3(c.osnrOut)]),
        ),
      );
      md.push("");
    }
  }

  md.push("## Issues", "");
  if (!results.issues.length) md.push("_No issues._");
  for (const i of results.issues) {
    const where = [i.element, i.port].filter(Boolean).join(".");
    md.push(`- **${i.severity}** \`${i.code}\`${where ? ` ${where}` : ""}${i.channel ? ` [${i.channel}]` : ""}: ${i.message}`);
  }
  md.push("");
  md.push(
    "",
    "---",
    "",
    "*Generated by Lumantite. This report is a planning estimate produced from user-supplied catalog data",
    "and simplified physical models; it may be wrong and is provided without warranty of any kind. Verify",
    "every value against manufacturer datasheets and field measurements before acting on it. The author",
    "accepts no liability for decisions based on this output (see DISCLAIMER.md and the Apache-2.0 LICENSE).*",
    "",
  );
  return md.join("\n");
}
