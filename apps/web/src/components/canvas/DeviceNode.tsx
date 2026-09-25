import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { DeviceData } from "./graph";
import { useResults } from "../../store/resultsStore";
import { useUi } from "../../store/uiStore";
import { portIndex } from "../../store/selectors";
import { STATUS_COLOR } from "../../lib/status";
import { useDecor } from "./decor";

const KIND_BADGE: Record<string, string> = {
  transceiver: "TRX", mux: "MUX", amplifier: "AMP", attenuator: "ATT", dcm: "DCM", splitter: "SPL", passthrough: "PP", host: "HOST",
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
        className={`port-${status === "n/a" ? "na" : status}`}
        style={{ top }}
        onMouseEnter={(e) => setHover({ node, port: name, x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setHover(null)}
        title={`${name} (${direction}${channel ? `, ${channel}` : ""})`}
      />
      <span
        className={`absolute text-[9px] leading-none text-muted pointer-events-none ${side === "left" ? "left-2" : "right-2"}`}
        style={{ top: top - 4 }}
      >
        {name}
        {direction !== "bidi" && <span className="text-faint">{direction === "in" ? " ◂" : " ▸"}</span>}
      </span>
    </>
  );
}

function DeviceNodeImpl({ id, data, selected, width, height }: NodeProps<Node<DeviceData>>) {
  const status = useResults((s) => s.results?.elementStatus[id] ?? "n/a");
  const hasError = useDecor((s) => s.errorIds.has(id));
  const onPath = useDecor((s) => (s.pathIds ? s.pathIds.has(id) : null));
  const dimmed = onPath === false;
  const toggle = useUi((s) => s.toggleExpanded);
  const kind = data.model?.kind ?? "unknown";
  const badge = KIND_BADGE[kind];
  return (
    <div
      className={`relative rounded border-2 bg-raised text-fg shadow-md shadow-black/30 ${selected ? "ring-2 ring-accent ring-offset-2 ring-offset-page" : onPath ? "ring-1 ring-accent/60 shadow-[0_0_10px_rgb(242_193_78/0.25)]" : ""} ${hasError ? "outline-2 outline-offset-[5px] outline-fail" : ""} ${dimmed ? "opacity-35" : ""}`}
      style={{ width, height, borderColor: status === "n/a" ? "#4a4d55" : STATUS_COLOR[status] }}
      data-testid={`device-${id}`}
    >
      <div className="px-1.5 pt-0.5 flex items-center gap-1">
        <span className={`text-[9px] font-bold rounded px-1 ${badge ? "bg-line text-fg" : "bg-fail/20 text-fail"}`}>{badge ?? "?"}</span>
        <span className="font-semibold truncate text-[11px]" title={id}>{id}</span>
      </div>
      <div className="px-1.5 text-[9px] text-muted truncate" title={data.inst.model}>{data.inst.model}{data.inst.settings?.channel ? ` @${data.inst.settings.channel}` : ""}</div>
      {data.ports.map((p) => (
        <PortHandle key={p.name} node={id} name={p.name} side={p.side} top={p.top} direction={p.spec.direction} channel={p.spec.channel} />
      ))}
      {data.expandable && (
        <button
          className="nodrag absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[9px] text-accent hover:text-accent-hover hover:underline"
          onClick={(e) => { e.stopPropagation(); toggle(id); }}
        >
          {data.hiddenPorts ? `+${data.hiddenPorts} ports` : "collapse"}
        </button>
      )}
    </div>
  );
}
export const DeviceNode = memo(DeviceNodeImpl);
