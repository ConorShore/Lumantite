import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { DeviceData } from "./graph";
import { useResults } from "../../store/resultsStore";
import { useUi } from "../../store/uiStore";
import { portIndex } from "../../store/selectors";
import { STATUS_COLOR } from "../../lib/status";
import { useDecor } from "./decor";

const KIND_STYLE: Record<string, { badge: string; bg: string }> = {
  transceiver: { badge: "TRX", bg: "bg-sky-50" },
  mux: { badge: "MUX", bg: "bg-violet-50" },
  amplifier: { badge: "AMP", bg: "bg-orange-50" },
  attenuator: { badge: "ATT", bg: "bg-slate-50" },
  dcm: { badge: "DCM", bg: "bg-teal-50" },
  splitter: { badge: "SPL", bg: "bg-lime-50" },
  passthrough: { badge: "PP", bg: "bg-slate-50" },
  host: { badge: "HOST", bg: "bg-stone-100" },
};

function PortHandle({ node, name, side, top, direction, channel }: { node: string; name: string; side: "left" | "right"; top: number; direction: string; channel?: string }) {
  const status = useResults((s) => portIndex(s.results)?.get(`${node}.${name}`)?.status ?? "n/a");
  const setHover = useDecor((s) => s.setHover);
  return (
    <>
      <Handle
        type="source"
        id={name}
        position={side === "left" ? Position.Left : Position.Right}
        style={{ top, background: STATUS_COLOR[status], borderColor: "#334155" }}
        onMouseEnter={(e) => setHover({ node, port: name, x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setHover(null)}
        title={`${name} (${direction}${channel ? `, ${channel}` : ""})`}
      />
      <span
        className={`absolute text-[9px] leading-none text-slate-600 pointer-events-none ${side === "left" ? "left-2" : "right-2"}`}
        style={{ top: top - 4 }}
      >
        {name}
        {direction !== "bidi" && <span className="text-slate-400">{direction === "in" ? " ◂" : " ▸"}</span>}
      </span>
    </>
  );
}

function DeviceNodeImpl({ id, data, selected, width, height }: NodeProps<Node<DeviceData>>) {
  const status = useResults((s) => s.results?.elementStatus[id] ?? "n/a");
  const hasError = useDecor((s) => s.errorIds.has(id));
  const dimmed = useDecor((s) => (s.pathIds ? !s.pathIds.has(id) : false));
  const toggle = useUi((s) => s.toggleExpanded);
  const kind = data.model?.kind ?? "unknown";
  const ks = KIND_STYLE[kind] ?? { badge: "?", bg: "bg-red-50" };
  return (
    <div
      className={`relative rounded border-2 shadow-sm ${ks.bg} ${selected ? "ring-2 ring-sky-500" : ""} ${hasError ? "outline-2 outline-offset-2 outline-red-600" : ""} ${dimmed ? "opacity-40" : ""}`}
      style={{ width, height, borderColor: STATUS_COLOR[status] }}
      data-testid={`device-${id}`}
    >
      <div className="px-1.5 pt-0.5 flex items-center gap-1">
        <span className="text-[9px] font-bold rounded bg-slate-700 text-white px-1">{ks.badge}</span>
        <span className="font-semibold truncate text-[11px]" title={id}>{id}</span>
      </div>
      <div className="px-1.5 text-[9px] text-slate-500 truncate" title={data.inst.model}>{data.inst.model}{data.inst.settings?.channel ? ` @${data.inst.settings.channel}` : ""}</div>
      {data.ports.map((p) => (
        <PortHandle key={p.name} node={id} name={p.name} side={p.side} top={p.top} direction={p.spec.direction} channel={p.spec.channel} />
      ))}
      {data.expandable && (
        <button
          className="nodrag absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[9px] text-sky-700 hover:underline"
          onClick={(e) => { e.stopPropagation(); toggle(id); }}
        >
          {data.hiddenPorts ? `+${data.hiddenPorts} ports` : "collapse"}
        </button>
      )}
    </div>
  );
}
export const DeviceNode = memo(DeviceNodeImpl);
