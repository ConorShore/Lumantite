import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps, type Edge } from "@xyflow/react";
import type { FibreData } from "./graph";
import { useResults } from "../../store/resultsStore";
import { useUi } from "../../store/uiStore";
import { fibreChannels } from "../../store/selectors";
import { STATUS_COLOR } from "../../lib/status";
import { useDecor } from "./decor";

function FibreEdgeImpl({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<Edge<FibreData>>) {
  const status = useResults((s) => s.results?.elementStatus[id] ?? "n/a");
  const hasError = useDecor((s) => s.errorIds.has(id));
  const onPath = useDecor((s) => (s.pathIds ? s.pathIds.has(id) : null));
  const filter = useUi((s) => s.channelFilter);
  const carries = useResults((s) => (filter ? fibreChannels(s.results)?.get(id)?.has(`${filter.plan}:${filter.channel}`) ?? false : true));
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
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
