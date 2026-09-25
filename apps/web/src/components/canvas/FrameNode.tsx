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
        lineStyle={{ borderColor: "var(--color-accent)" }}
        handleStyle={{ background: "var(--color-accent)", borderColor: "var(--color-page)" }}
        onResizeEnd={(_, p) =>
          useProject.getState().applyOps([{ op: "setLayout", kind: data.kind, id: data.id, rect: { x: p.x, y: p.y, w: p.width, h: p.height } }])
        }
      />
      <div
        className={`h-full w-full rounded ${isFile ? "border-2 border-dashed border-aqua/35 bg-aqua/[0.025]" : "border border-muted/35 bg-fg/[0.025]"} ${selected ? "!border-accent/70" : ""}`}
        style={{ width, height }}
      >
        <div
          className={`frame-grip inline-flex items-center gap-1 cursor-move rounded-br px-1.5 py-0.5 text-[10px] ${isFile ? "bg-aqua/12 text-aqua" : "bg-raised text-muted border-r border-b border-line"}`}
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
