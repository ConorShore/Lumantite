import { memo, useEffect } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps, type Edge } from "@xyflow/react";
import type { FibreData } from "./graph";
import { useResults } from "../../store/resultsStore";
import { useUi } from "../../store/uiStore";
import { fibreChannels } from "../../store/selectors";
import { STATUS_COLOR } from "../../lib/status";
import { useDecor } from "./decor";
import { useRouting } from "./routing";

function FibreEdgeImpl({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<Edge<FibreData>>) {
  const status = useResults((s) => s.results?.elementStatus[id] ?? "n/a");
  const hasError = useDecor((s) => s.errorIds.has(id));
  const onPath = useDecor((s) => (s.pathIds ? s.pathIds.has(id) : null));
  const filter = useUi((s) => s.channelFilter);
  const carries = useResults((s) => (filter ? fibreChannels(s.results)?.get(id)?.has(`${filter.plan}:${filter.channel}`) ?? false : true));
  // our own right-angle route goes to the canvas-wide router, which hands back a path laned apart from its neighbours
  const [base, bx, by] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 0 });
  const net = data?.net ?? id;
  useEffect(() => { useRouting.getState().setRoute(id, net, base); }, [id, net, base]);
  useEffect(() => () => useRouting.getState().removeRoute(id), [id]);
  const routed = useRouting((s) => s.routed.get(id));
  const [path, lx, ly] = routed ? [routed.d, routed.lx, routed.ly] : [base, bx, by];
  const dim = !carries || onPath === false;
  const color = STATUS_COLOR[status];
  const width = selected || onPath ? 3.5 : 2;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={14}
        style={{
          stroke: color, strokeWidth: width, opacity: dim ? 0.15 : 1,
          strokeDasharray: hasError ? "6 3" : undefined,
          // gold halo for the selection and the selected signal's path; the stroke keeps its status colour
          filter: selected ? "drop-shadow(0 0 3px #f2c14e) drop-shadow(0 0 1px #f2c14e)" : onPath ? "drop-shadow(0 0 3px rgb(242 193 78 / 0.8))" : undefined,
        }}
      />
      {routed?.dots.map((p) => <circle key={`${p.x},${p.y}`} cx={p.x} cy={p.y} r={3.5} fill={color} opacity={dim ? 0.15 : 1} pointerEvents="none" />)}
      <EdgeLabelRenderer>
        <div
          className={`nodrag nopan absolute rounded px-1 text-[9px] leading-3 border bg-surface/95 ${hasError ? "border-fail/70 text-fail" : onPath ? "border-accent/50 text-fg" : "border-line text-fg/85"} ${selected ? "ring-1 ring-accent" : ""}`}
          style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, opacity: dim ? 0.25 : 1, pointerEvents: "all" }}
        >
          {data?.label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
export const FibreEdge = memo(FibreEdgeImpl);
