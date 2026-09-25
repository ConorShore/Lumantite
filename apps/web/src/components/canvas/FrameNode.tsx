import { memo } from "react";
import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import type { FrameData } from "./graph";
import { useProject } from "../../store/projectStore";

function FrameNodeImpl({ data, selected, width, height }: NodeProps<Node<FrameData>>) {
  const isFile = data.kind === "file";
  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={120}
        minHeight={80}
        lineStyle={{ borderColor: "#0284c7" }}
        onResizeEnd={(_, p) =>
          useProject.getState().applyOps([{ op: "setLayout", kind: data.kind, id: data.id, rect: { x: p.x, y: p.y, w: p.width, h: p.height } }])
        }
      />
      <div
        className={`h-full w-full rounded ${isFile ? "border-2 border-dashed border-slate-400 bg-slate-400/5" : "border border-emerald-500/60 bg-emerald-500/5"}`}
        style={{ width, height }}
      >
        <div
          className={`frame-grip inline-flex items-center gap-1 cursor-move rounded-br px-1.5 py-0.5 text-[10px] ${isFile ? "bg-slate-200 text-slate-700" : "bg-emerald-100 text-emerald-800"}`}
          title={isFile ? "File frame: drop elements inside to move them into this file" : "Site frame"}
        >
          <span>{isFile ? "📄" : "▣"}</span>
          <span className="font-semibold">{data.label}</span>
          {data.sub && <span className="opacity-60">{data.sub}</span>}
        </div>
      </div>
    </>
  );
}
export const FrameNode = memo(FrameNodeImpl);
