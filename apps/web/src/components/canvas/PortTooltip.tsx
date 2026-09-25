import { useDecor } from "./decor";
import { useResults } from "../../store/resultsStore";
import { portIndex } from "../../store/selectors";
import { dB, cd } from "../../lib/format";
import type { PortChannelResult } from "@optiplanner/schema";

function Rows({ title, chans, total }: { title: string; chans: PortChannelResult[]; total?: { min: number; typ: number; max: number } }) {
  if (!chans.length) return null;
  return (
    <>
      <tr><td colSpan={5} className="pt-1 font-semibold text-slate-600">{title}{total && <span className="font-normal"> — total {dB(total.typ)} dBm</span>}</td></tr>
      {chans.slice(0, 20).map((c) => (
        <tr key={c.signalId} className="tabular-nums">
          <td className="pr-2">{c.channel.id}</td>
          <td className="pr-1 text-right">{dB(c.power.min)}</td>
          <td className="pr-1 text-right font-medium">{dB(c.power.typ)}</td>
          <td className="pr-2 text-right">{dB(c.power.max)}</td>
          <td className="text-right">{cd(c.cd)}</td>
        </tr>
      ))}
      {chans.length > 20 && <tr><td colSpan={5} className="text-slate-400">… {chans.length - 20} more</td></tr>}
    </>
  );
}

export function PortTooltip() {
  const hover = useDecor((s) => s.hover);
  const pr = useResults((s) => (hover ? portIndex(s.results)?.get(`${hover.node}.${hover.port}`) : undefined));
  if (!hover) return null;
  return (
    <div className="fixed z-50 pointer-events-none rounded border border-slate-300 bg-white px-2 py-1 shadow-lg text-[10px]" style={{ left: hover.x + 12, top: hover.y + 12 }} role="tooltip">
      <div className="font-semibold">{hover.node}.{hover.port}</div>
      {!pr || (!pr.in.channels.length && !pr.out.channels.length) ? (
        <div className="text-slate-400">no signal</div>
      ) : (
        <table>
          <thead><tr className="text-slate-400"><th className="text-left pr-2">ch</th><th className="pr-1">min</th><th className="pr-1">typ</th><th className="pr-2">max dBm</th><th>CD ps/nm</th></tr></thead>
          <tbody>
            <Rows title="in" chans={pr.in.channels} total={pr.in.totalPower} />
            <Rows title="out" chans={pr.out.channels} total={pr.out.totalPower} />
          </tbody>
        </table>
      )}
    </div>
  );
}
