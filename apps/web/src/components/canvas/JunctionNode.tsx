import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { JunctionData } from "./graph";

function JunctionNodeImpl({ data }: NodeProps<Node<JunctionData>>) {
  const loose = data.label !== "splice";
  return (
    <div className={`h-2.5 w-2.5 rounded-full border ${loose ? "border-fail bg-page" : "border-line bg-na"}`} title={data.label}>
      {/* both handles sit at the centre; the side only tells the router which way the fibre leaves */}
      <Handle type="source" id="l" position={Position.Left} isConnectable={false} style={{ opacity: 0, top: 4, left: 4, width: 1, height: 1 }} />
      <Handle type="source" id="r" position={Position.Right} isConnectable={false} style={{ opacity: 0, top: 4, left: 4, width: 1, height: 1 }} />
      {loose && <span className="absolute left-3 -top-1 whitespace-nowrap text-[9px] text-fail">{data.label}</span>}
    </div>
  );
}
export const JunctionNode = memo(JunctionNodeImpl);
