import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_MARGINS, type Margins, type ResolvedMargins, type Results, type CheckStatus } from "@optiplanner/schema";
import { useProject } from "../../store/projectStore";
import { useConfig } from "../../store/configStore";
import { useResults } from "../../store/resultsStore";
import { Count } from "../common/StatusBadge";

const FIELDS: { key: keyof ResolvedMargins; label: string; unit: string; help: string; step?: number; int?: boolean }[] = [
  { key: "system_margin_dB", label: "System margin", unit: "dB", help: "Subtracted from worst-case Rx power before comparing with sensitivity." },
  { key: "ageing_dB", label: "Ageing", unit: "dB", help: "End-of-life degradation of fibre and components." },
  { key: "repair_splices", label: "Repair splices", unit: "count", help: "Future splices per link reserved for repairs.", step: 1, int: true },
  { key: "repair_splice_loss_dB", label: "Repair splice loss", unit: "dB each", help: "Loss assumed per repair splice." },
  { key: "connector_ageing_dB", label: "Connector ageing", unit: "dB / connector", help: "Extra loss per connector on the path." },
  { key: "cd_margin_pct", label: "CD margin", unit: "%", help: "Accumulated CD is scaled by (1 + pct/100) before the tolerance check." },
  { key: "max_channel_imbalance_dB", label: "Max channel imbalance", unit: "dB", help: "Max − min channel power at mux common ports and amplifiers." },
];

function checkStatuses(r: Results | null): Map<string, CheckStatus> {
  const m = new Map<string, CheckStatus>();
  for (const s of r?.signals ?? []) for (const c of s.checks) m.set(`${s.id}|${c.code}`, c.status);
  return m;
}

export function MarginsTab() {
  const model = useProject((s) => s.model);
  const apply = useProject((s) => s.applyOps);
  const configDefaults = useConfig((s) => s.config.defaults.margins);
  const results = useResults((s) => s.results);
  const computing = useResults((s) => s.computing);
  const saved = model?.project.margins ?? {};
  const [draft, setDraft] = useState<Margins>(saved);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (!timer.current) setDraft(model?.project.margins ?? {}); }, [model]);

  // Baseline for "how many checks change status": the results when the page was opened.
  const [baseline, setBaseline] = useState<Map<string, CheckStatus> | null>(null);
  useEffect(() => { if (!baseline && results) setBaseline(checkStatuses(results)); }, [results, baseline]);
  const changed = useMemo(() => {
    if (!baseline || !results) return { total: 0, worse: 0, better: 0 };
    const rank: Record<CheckStatus, number> = { "n/a": 0, pass: 1, warn: 2, fail: 3 };
    let worse = 0, better = 0;
    for (const [k, st] of checkStatuses(results)) {
      const b = baseline.get(k);
      if (!b || b === st) continue;
      if (rank[st] > rank[b]) worse++; else better++;
    }
    return { total: worse + better, worse, better };
  }, [baseline, results]);

  if (!model) return <div className="p-6 text-slate-500">No project loaded.</div>;
  const dflt = (k: keyof ResolvedMargins) => configDefaults[k] ?? DEFAULT_MARGINS[k];
  const set = (k: keyof ResolvedMargins, v: number | undefined) => {
    const next = { ...draft, [k]: v };
    if (v === undefined) delete next[k];
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; apply([{ op: "setMargins", margins: next }]); }, 250);
  };
  const s = results?.summary;

  return (
    <div className="max-w-3xl p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold">Project margins</h2>
        <span className="text-slate-500">applied to every check (SPEC §7.8); blank = default</span>
      </div>
      <div className="mb-4 flex items-center gap-2 rounded border border-slate-200 bg-slate-50 p-2">
        <span className="text-slate-600">Signals:</span>
        {s ? (<><Count n={s.pass} status="pass" /><Count n={s.warn} status="warn" /><Count n={s.fail} status="fail" /></>) : <span>—</span>}
        {computing && <span className="text-slate-400">computing…</span>}
        <span className="ml-4 text-slate-600" data-testid="margins-delta">
          {changed.total ? <>{changed.total} checks changed since opened (<span className="text-red-700">{changed.worse} worse</span>, <span className="text-green-700">{changed.better} better</span>)</> : "no status changes yet"}
        </span>
        <button className="ml-auto rounded border bg-white px-2" onClick={() => setBaseline(checkStatuses(results))}>Reset baseline</button>
      </div>
      <table className="w-full">
        <thead><tr className="text-left text-slate-500"><th className="py-1">Margin</th><th>Value</th><th>Default</th><th>Unit</th><th /></tr></thead>
        <tbody>
          {FIELDS.map((f) => {
            const v = draft[f.key];
            return (
              <tr key={f.key} className="border-t border-slate-100" title={f.help}>
                <td className="py-1 pr-2"><div className="font-medium">{f.label}</div><div className="font-mono text-[10px] text-slate-400">{f.key}</div></td>
                <td>
                  <input
                    aria-label={f.key}
                    className={`w-24 rounded border px-1 tabular-nums ${v === undefined ? "border-slate-200" : "border-sky-400 bg-sky-50"}`}
                    type="number" step={f.step ?? 0.1} min={0}
                    placeholder={String(dflt(f.key))}
                    value={v ?? ""}
                    onChange={(e) => {
                      const n = e.target.value === "" ? undefined : Number(e.target.value);
                      if (n === undefined || Number.isFinite(n)) set(f.key, n !== undefined && f.int ? Math.round(n) : n);
                    }}
                  />
                </td>
                <td className="tabular-nums text-slate-500">{dflt(f.key)}</td>
                <td className="text-slate-500">{f.unit}</td>
                <td>{v !== undefined && <button className="text-sky-700" onClick={() => set(f.key, undefined)}>reset</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!!saved && <p className="mt-3 text-[11px] text-slate-400">Stored under <code>project.margins</code> in {model.rootFile}.</p>}
    </div>
  );
}
