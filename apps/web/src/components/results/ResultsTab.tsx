import { useMemo, useState } from "react";
import type { SignalResult, PortResult, FibreResult, AmplifierResult } from "@lumantite/schema";
import { useResults } from "../../store/resultsStore";
import { useUi } from "../../store/uiStore";
import { dB, cd, nm } from "../../lib/format";
import { StatusBadge } from "../common/StatusBadge";
import { DataTable, type Column } from "./DataTable";

type Sub = "signals" | "ports" | "fibres" | "amplifiers";

const margin = (s: SignalResult, code: string) => s.checks.find((c) => c.code === code)?.margin;

function LinkBudget({ s }: { s: SignalResult }) {
  return (
    <div>
      <div className="mb-1 font-semibold">Link budget {s.id} → {s.rx ? `${s.rx.node}.${s.rx.port}` : `(${s.terminated})`}</div>
      <table className="text-[11px]">
        <thead><tr className="text-left text-slate-500"><th className="pr-3">#</th><th className="pr-3">element</th><th className="pr-3">kind</th><th className="pr-3">in → out</th><th className="pr-3 text-right">Δ min/typ/max dB</th><th className="pr-3 text-right">power min/typ/max dBm</th><th className="pr-3 text-right">ΔCD</th><th className="text-right">CD ps/nm</th><th className="pl-3">note</th></tr></thead>
        <tbody className="tabular-nums">
          {s.path.map((p, i) => {
            return (
              <tr key={i} className="border-t border-slate-200">
                <td className="pr-3 text-slate-400">{i}</td>
                <td className="pr-3 font-mono">{p.element}</td>
                <td className="pr-3">{p.kind}</td>
                <td className="pr-3 font-mono">{p.inPort ?? ""}{p.inPort || p.outPort ? " → " : ""}{p.outPort ?? ""}</td>
                <td className="pr-3 text-right">{dB(p.deltaPower.min)} / {dB(p.deltaPower.typ)} / {dB(p.deltaPower.max)}</td>
                <td className="pr-3 text-right font-medium">{dB(p.power.min)} / {dB(p.power.typ)} / {dB(p.power.max)}</td>
                <td className="pr-3 text-right">{cd(p.deltaCd)}</td>
                <td className="text-right">{cd(p.cd)}</td>
                <td className="pl-3 text-slate-500">{p.note ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-2 space-y-0.5">
        {s.checks.map((c) => <div key={c.code} className="flex gap-2"><StatusBadge status={c.status} /><span className="font-mono">{c.code}</span><span>{c.message}</span>{c.margin !== undefined && <span className="tabular-nums text-slate-500">margin {dB(c.margin)}</span>}</div>)}
      </div>
    </div>
  );
}

export function ResultsTab() {
  const results = useResults((s) => s.results);
  const error = useResults((s) => s.error);
  const [sub, setSub] = useState<Sub>("signals");
  const select = useUi((s) => s.select);

  const signalCols = useMemo<Column<SignalResult>[]>(() => [
    { key: "status", header: "status", value: (s) => s.status, render: (s) => <StatusBadge status={s.status} /> },
    { key: "tx", header: "tx", value: (s) => `${s.tx.node}.${s.tx.port}` },
    { key: "rx", header: "rx", value: (s) => (s.rx ? `${s.rx.node}.${s.rx.port}` : `(${s.terminated})`) },
    { key: "ch", header: "channel", value: (s) => s.channel.id },
    { key: "nm", header: "λ nm", value: (s) => s.channel.wavelength_nm, render: (s) => nm(s.channel.wavelength_nm), align: "right" },
    { key: "pmin", header: "Rx min", value: (s) => s.powerAtEnd.min, render: (s) => dB(s.powerAtEnd.min), align: "right" },
    { key: "ptyp", header: "Rx typ", value: (s) => s.powerAtEnd.typ, render: (s) => dB(s.powerAtEnd.typ), align: "right" },
    { key: "pmax", header: "Rx max", value: (s) => s.powerAtEnd.max, render: (s) => dB(s.powerAtEnd.max), align: "right" },
    { key: "msens", header: "margin sens.", value: (s) => margin(s, "rx.power_low"), render: (s) => dB(margin(s, "rx.power_low")), align: "right" },
    { key: "mover", header: "margin overl.", value: (s) => margin(s, "rx.power_high"), render: (s) => dB(margin(s, "rx.power_high")), align: "right" },
    { key: "cd", header: "CD ps/nm", value: (s) => s.cdAtEnd, render: (s) => cd(s.cdAtEnd), align: "right" },
    { key: "steps", header: "steps", value: (s) => s.path.length, align: "right" },
  ], []);

  const portCols = useMemo<Column<PortResult>[]>(() => [
    { key: "status", header: "status", value: (p) => p.status, render: (p) => <StatusBadge status={p.status} /> },
    { key: "node", header: "node", value: (p) => p.node },
    { key: "port", header: "port", value: (p) => p.port },
    { key: "inCh", header: "in ch", value: (p) => p.in.channels.length, align: "right" },
    { key: "inTot", header: "in total typ", value: (p) => p.in.totalPower?.typ, render: (p) => dB(p.in.totalPower?.typ), align: "right" },
    { key: "outCh", header: "out ch", value: (p) => p.out.channels.length, align: "right" },
    { key: "outTot", header: "out total typ", value: (p) => p.out.totalPower?.typ, render: (p) => dB(p.out.totalPower?.typ), align: "right" },
    { key: "chs", header: "channels", value: (p) => [...new Set([...p.in.channels, ...p.out.channels].map((c) => c.channel.id))].join(" ") },
  ], []);

  const fibreCols = useMemo<Column<FibreResult>[]>(() => [
    { key: "status", header: "status", value: (f) => f.status, render: (f) => <StatusBadge status={f.status} /> },
    { key: "id", header: "fibre", value: (f) => f.id },
    { key: "len", header: "km", value: (f) => f.length_km, align: "right" },
    { key: "loss", header: "loss typ dB", value: (f) => f.loss.typ, render: (f) => dB(f.loss.typ), align: "right" },
    { key: "ab", header: "a>b ch / total", value: (f) => f.directions.find((d) => d.direction === "a>b")?.channels.length, render: (f) => { const d = f.directions.find((x) => x.direction === "a>b"); return d ? `${d.channels.length} / ${dB(d.totalPower?.typ)}` : "–"; }, align: "right" },
    { key: "ba", header: "b>a ch / total", value: (f) => f.directions.find((d) => d.direction === "b>a")?.channels.length, render: (f) => { const d = f.directions.find((x) => x.direction === "b>a"); return d ? `${d.channels.length} / ${dB(d.totalPower?.typ)}` : "–"; }, align: "right" },
  ], []);

  const ampCols = useMemo<Column<AmplifierResult>[]>(() => [
    { key: "status", header: "status", value: (a) => a.status, render: (a) => <StatusBadge status={a.status} /> },
    { key: "id", header: "amplifier", value: (a) => a.id },
    { key: "mode", header: "mode", value: (a) => a.mode },
    { key: "model", header: "gain model", value: (a) => a.gainModel },
    { key: "pin", header: "Pin typ", value: (a) => a.pinTotal.typ, render: (a) => dB(a.pinTotal.typ), align: "right" },
    { key: "pout", header: "Pout typ", value: (a) => a.poutTotal.typ, render: (a) => dB(a.poutTotal.typ), align: "right" },
    { key: "g", header: "gain typ", value: (a) => a.gainEffective.typ, render: (a) => dB(a.gainEffective.typ), align: "right" },
    { key: "head", header: "headroom", value: (a) => a.headroom_dB, render: (a) => dB(a.headroom_dB), align: "right" },
    { key: "imbIn", header: "imb. in", value: (a) => a.imbalanceIn_dB, render: (a) => dB(a.imbalanceIn_dB), align: "right" },
    { key: "imbOut", header: "imb. out", value: (a) => a.imbalanceOut_dB, render: (a) => dB(a.imbalanceOut_dB), align: "right" },
    { key: "ch", header: "channels", value: (a) => a.perChannel.length, align: "right" },
  ], []);

  if (!results) return <div className="p-6 text-slate-500">{error ? `Compute failed: ${error}` : "No results yet."}</div>;
  const counts: Record<Sub, number> = { signals: results.signals.length, ports: results.ports.length, fibres: results.fibres.length, amplifiers: results.amplifiers.length };
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1">
        {(Object.keys(counts) as Sub[]).map((k) => (
          <button key={k} className={`rounded px-2 py-0.5 ${k === sub ? "bg-sky-600 text-white" : "hover:bg-slate-200"}`} onClick={() => setSub(k)}>{k} <span className="opacity-60">{counts[k]}</span></button>
        ))}
        <span className="ml-auto text-slate-400">computed {new Date(results.computedAt).toLocaleTimeString()}</span>
      </div>
      <div className="flex-1 min-h-0">
        {sub === "signals" && <DataTable rows={results.signals} columns={signalCols} rowKey={(s) => s.id} renderExpanded={(s) => <LinkBudget s={s} />} onRowClick={(s) => select([{ kind: "node", id: s.tx.node }])} initialSort={{ key: "status", dir: -1 }} />}
        {sub === "ports" && <DataTable rows={results.ports} columns={portCols} rowKey={(p) => `${p.node}.${p.port}`} onRowClick={(p) => select([{ kind: "node", id: p.node }])} />}
        {sub === "fibres" && <DataTable rows={results.fibres} columns={fibreCols} rowKey={(f) => f.id} onRowClick={(f) => select([{ kind: "fibre", id: f.id }])} />}
        {sub === "amplifiers" && <DataTable rows={results.amplifiers} columns={ampCols} rowKey={(a) => a.id} onRowClick={(a) => select([{ kind: "node", id: a.id }])} renderExpanded={(a) => (
          <table className="text-[11px] tabular-nums">
            <thead><tr className="text-slate-500"><th className="pr-3 text-left">channel</th><th className="pr-3 text-right">pin typ</th><th className="pr-3 text-right">gain min/typ/max</th><th className="text-right">pout typ</th></tr></thead>
            <tbody>{a.perChannel.map((c) => <tr key={c.signalId}><td className="pr-3">{c.channel.id}</td><td className="pr-3 text-right">{dB(c.pin.typ)}</td><td className="pr-3 text-right">{dB(c.gain.min)} / {dB(c.gain.typ)} / {dB(c.gain.max)}</td><td className="text-right">{dB(c.pout.typ)}</td></tr>)}</tbody>
          </table>
        )} />}
      </div>
    </div>
  );
}
