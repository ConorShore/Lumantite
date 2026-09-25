import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap, ConnectionMode, applyNodeChanges, applyEdgeChanges,
  useReactFlow, useUpdateNodeInternals,
  type Node, type Edge, type NodeChange, type EdgeChange, type Connection, type OnSelectionChangeParams,
} from "@xyflow/react";
import type { Op } from "../../adapters/project";
import { useProject } from "../../store/projectStore";
import { useCatalog } from "../../store/catalogStore";
import { useResults } from "../../store/resultsStore";
import { useUi, type SelItem } from "../../store/uiStore";
import { useAllIssues } from "../../store/hooks";
import { signalsByElement } from "../../store/selectors";
import { nextId, KIND_PREFIX } from "../../lib/ids";
import { buildGraph, smallestContaining, fileFrameRect, NODE_W, type DeviceData, type FrameData, type Rect } from "./graph";
import { DeviceNode } from "./DeviceNode";
import { FrameNode } from "./FrameNode";
import { JunctionNode } from "./JunctionNode";
import { FibreEdge } from "./FibreEdge";
import { PortTooltip } from "./PortTooltip";
import { Palette, DND_MIME } from "./Palette";
import { ConnectPopover, type PendingConnection } from "./ConnectPopover";
import { CanvasToolbar } from "./CanvasToolbar";
import { useDecor } from "./decor";

const nodeTypes = { device: DeviceNode, fileFrame: FrameNode, siteFrame: FrameNode, junction: JunctionNode };
const edgeTypes = { fibre: FibreEdge };

export function CanvasTab() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}

const rfNodeId = (s: SelItem) => (s.kind === "node" ? s.id : s.kind === "site" ? `site:${s.id}` : s.kind === "file" ? `file:${s.id}` : null);
function selOfNode(n: Node): SelItem | null {
  if (n.type === "device") return { kind: "node", id: n.id };
  if (n.type === "siteFrame" || n.type === "fileFrame") { const d = n.data as FrameData; return { kind: d.kind === "file" ? "file" : "site", id: d.id }; }
  return null;
}
const sameSel = (a: SelItem[], b: SelItem[]) => a.length === b.length && a.every((x) => b.some((y) => y.kind === x.kind && y.id === x.id));
const rectOf = (n: Node): Rect => ({ x: n.position.x, y: n.position.y, w: n.width ?? n.measured?.width ?? 0, h: n.height ?? n.measured?.height ?? 0 });
const center = (n: Node) => { const r = rectOf(n); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };

function CanvasInner() {
  const model = useProject((s) => s.model);
  const catalog = useCatalog((s) => s.catalog);
  const results = useResults((s) => s.results);
  const showFileFrames = useUi((s) => s.showFileFrames);
  const expanded = useUi((s) => s.expandedNodes);
  const selection = useUi((s) => s.selection);
  const focusRev = useUi((s) => s.focusRev);
  const issues = useAllIssues();
  const rf = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const wrapper = useRef<HTMLDivElement>(null);
  const mouse = useRef({ x: 0, y: 0 });
  const [pending, setPending] = useState<PendingConnection | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(true);

  // ---------------------------------------------------------------- derived graph
  const graph = useMemo(() => (model ? buildGraph(model, catalog, { showFileFrames, expanded }) : null), [model, catalog, showFileFrames, expanded]);
  const selectedNodeIds = useMemo(() => new Set(selection.map(rfNodeId).filter(Boolean) as string[]), [selection]);
  const selectedFibres = useMemo(() => new Set(selection.filter((s) => s.kind === "fibre").map((s) => s.id)), [selection]);

  const nodesRef = useRef<Node[]>([]);
  const [nodes, setNodesState] = useState<Node[]>([]);
  const setNodes = (next: Node[]) => { nodesRef.current = next; setNodesState(next); };
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    setNodes((graph?.nodes ?? []).map((n) => {
      const p = prev.get(n.id);
      const selected = selectedNodeIds.has(n.id);
      return p?.dragging ? { ...n, position: p.position, dragging: true, selected } : { ...n, selected };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, selectedNodeIds]);
  useEffect(() => {
    setEdges((graph?.edges ?? []).map((e) => ({ ...e, selected: selectedFibres.has(e.id) })));
  }, [graph, selectedFibres]);
  useEffect(() => {
    if (graph) updateNodeInternals(graph.nodes.filter((n) => n.type === "device").map((n) => n.id));
  }, [graph, updateNodeInternals]);

  // ---------------------------------------------------------------- decorations
  useEffect(() => {
    useDecor.setState({ errorIds: new Set(issues.filter((i) => i.severity === "error" && i.element).map((i) => i.element!)) });
  }, [issues]);
  useEffect(() => {
    const idx = signalsByElement(results);
    const txs = selection.filter((s) => s.kind === "node" && model?.nodes.find((n) => n.id === s.id && catalog.models.get(n.model)?.kind === "transceiver"));
    const fibres = selection.filter((s) => s.kind === "fibre");
    if (!idx || (!txs.length && !fibres.length)) { useDecor.setState({ pathIds: null }); return; }
    const ids = new Set<string>();
    const sigs = [
      ...(results?.signals.filter((s) => txs.some((t) => t.id === s.tx.node || t.id === s.rx?.node)) ?? []),
      ...fibres.flatMap((f) => idx.get(f.id) ?? []),
    ];
    for (const s of sigs) for (const p of s.path) ids.add(p.element);
    for (const t of txs) ids.add(t.id);
    for (const f of fibres) ids.add(f.id);
    useDecor.setState({ pathIds: ids });
  }, [selection, results, model, catalog]);

  // ---------------------------------------------------------------- focus on request (issue click)
  useEffect(() => {
    if (!focusRev) return;
    const sel = useUi.getState().selection;
    const ids = new Set<string>();
    for (const s of sel) {
      const id = rfNodeId(s);
      if (id) ids.add(id);
      if (s.kind === "fibre") { const e = edges.find((x) => x.id === s.id); if (e) { ids.add(e.source); ids.add(e.target); } }
    }
    if (ids.size) void rf.fitView({ nodes: [...ids].map((id) => ({ id })), duration: 300, padding: 0.6, maxZoom: 1.4 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRev]);

  // ---------------------------------------------------------------- node changes + frame dragging carries contents
  const dragMembers = useRef(new Map<string, string[]>());
  // File frames as they were at drag start, while dragged devices should stretch them (null otherwise)
  const frameBase = useRef<{ id: string; rect: Rect }[] | null>(null);
  /** File a dragged device lands in: the frame under its centre, else the file it already belongs to. */
  const dropFile = (n: Node) => {
    const c = center(n);
    return smallestContaining(frameBase.current ?? [], c.x, c.y)?.id ?? (n.data as DeviceData).inst.file;
  };
  /** Grow each file frame from its drag-start rect to hold its devices, counting dragged ones in their drop file. */
  const stretchFrames = (ns: Node[], dragged: Set<string>): Node[] => {
    const base = frameBase.current;
    if (!base) return ns;
    const members = new Map<string, Rect[]>();
    for (const n of ns) {
      if (n.type !== "device") continue;
      const file = dragged.has(n.id) ? dropFile(n) : (n.data as DeviceData).inst.file;
      members.set(file, [...(members.get(file) ?? []), rectOf(n)]);
    }
    const baseById = new Map(base.map((b) => [`file:${b.id}`, b.rect]));
    return ns.map((n) => {
      const b = baseById.get(n.id);
      if (!b) return n;
      const r = fileFrameRect(b, members.get((n.data as FrameData).id) ?? [])!;
      const cur = rectOf(n);
      if (r.x === cur.x && r.y === cur.y && r.w === cur.w && r.h === cur.h) return n;
      return { ...n, position: { x: r.x, y: r.y }, width: r.w, height: r.h, style: { ...n.style, width: r.w, height: r.h } };
    });
  };
  const draggingIds = useRef(new Set<string>());
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const cur = nodesRef.current;
    const byId = new Map(cur.map((n) => [n.id, n]));
    const extra: NodeChange[] = [];
    for (const c of changes) {
      if (c.type !== "position" || !c.position) continue;
      const members = dragMembers.current.get(c.id);
      const n = byId.get(c.id);
      if (!members || !n) continue;
      const dx = c.position.x - n.position.x;
      const dy = c.position.y - n.position.y;
      for (const m of members) {
        const mn = byId.get(m);
        if (mn) extra.push({ type: "position", id: m, position: { x: mn.position.x + dx, y: mn.position.y + dy } });
      }
    }
    setNodes(stretchFrames(applyNodeChanges([...changes, ...extra], cur), draggingIds.current));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((es) => applyEdgeChanges(changes, es)), []);

  const onNodeDragStart = useCallback((_: unknown, _node: Node, dragged: Node[]) => {
    dragMembers.current.clear();
    const draggedIds = new Set(dragged.map((d) => d.id));
    draggingIds.current = draggedIds;
    // dragging a file frame moves it rather than stretching it
    const stretch = useUi.getState().showFileFrames && !dragged.some((d) => d.type === "fileFrame");
    frameBase.current = stretch ? frameRects("fileFrame") : null;
    for (const f of dragged) {
      if (f.type !== "fileFrame" && f.type !== "siteFrame") continue;
      const r = rectOf(f);
      const members = nodesRef.current.filter((n) =>
        !draggedIds.has(n.id) && (n.type === "device" || (f.type === "fileFrame" && n.type === "siteFrame")) &&
        (() => { const c = center(n); return c.x >= r.x && c.x <= r.x + r.w && c.y >= r.y && c.y <= r.y + r.h; })());
      dragMembers.current.set(f.id, members.map((m) => m.id));
    }
  }, []);

  const frameRects = (type: "fileFrame" | "siteFrame") =>
    nodesRef.current.filter((n) => n.type === type).map((n) => ({ id: (n.data as FrameData).id, rect: rectOf(n) }));

  const onNodeDragStop = useCallback((_: unknown, _node: Node, dragged: Node[]) => {
    const m = useProject.getState().model;
    if (!m) return;
    const ops: Op[] = [];
    const byId = new Map(nodesRef.current.map((n) => [n.id, n]));
    const sites = frameRects("siteFrame");
    const layoutOf = (n: Node): Op | null => {
      if (n.type === "device") return { op: "setLayout", kind: "node", id: n.id, rect: { x: n.position.x, y: n.position.y } };
      if (n.type === "fileFrame" || n.type === "siteFrame") {
        const d = n.data as FrameData;
        const r = rectOf(n);
        return { op: "setLayout", kind: d.kind, id: d.id, rect: { x: r.x, y: r.y, w: r.w, h: r.h } };
      }
      return null;
    };
    for (const d of dragged) {
      const n = byId.get(d.id) ?? d;
      const lo = layoutOf(n);
      if (lo) ops.push(lo);
      for (const mid of dragMembers.current.get(n.id) ?? []) { const mn = byId.get(mid); const l = mn && layoutOf(mn); if (l) ops.push(l); }
      if (n.type !== "device") continue;
      const inst = (n.data as DeviceData).inst;
      const c = center(n);
      if (frameBase.current) {
        const target = dropFile(n);
        if (target !== inst.file) ops.push({ op: "moveToFile", kind: "node", id: inst.id, file: target });
      }
      const site = smallestContaining(sites, c.x, c.y)?.id;
      if (site !== inst.site && (site || m.layout.sites?.[inst.site ?? ""])) ops.push({ op: "updateNode", id: inst.id, patch: { site } });
    }
    // persist file frames that were stretched to hold the dropped devices
    for (const b of frameBase.current ?? []) {
      const n = byId.get(`file:${b.id}`);
      const r = n && rectOf(n);
      if (r && (r.x !== b.rect.x || r.y !== b.rect.y || r.w !== b.rect.w || r.h !== b.rect.h)) ops.push(layoutOf(n)!);
    }
    dragMembers.current.clear();
    draggingIds.current = new Set();
    frameBase.current = null;
    useProject.getState().applyOps(ops);
  }, []);

  // ---------------------------------------------------------------- selection
  const onSelectionChange = useCallback(({ nodes: ns, edges: es }: OnSelectionChangeParams) => {
    const items = [...(ns.map(selOfNode).filter(Boolean) as SelItem[]), ...es.map((e) => ({ kind: "fibre" as const, id: e.id }))];
    if (!sameSel(items, useUi.getState().selection)) useUi.getState().select(items);
  }, []);

  // ---------------------------------------------------------------- connect → popover
  const onConnect = useCallback((c: Connection) => {
    const m = useProject.getState().model;
    if (!m || !c.sourceHandle || !c.targetHandle) return;
    const src = nodesRef.current.find((n) => n.id === c.source);
    const tgt = nodesRef.current.find((n) => n.id === c.target);
    const portConn = (n: Node | undefined, h: string) => (n?.data as DeviceData | undefined)?.ports.find((p) => p.name === h)?.spec.connector;
    setPending({
      a: `${c.source}.${c.sourceHandle}`, b: `${c.target}.${c.targetHandle}`,
      file: (src?.data as DeviceData | undefined)?.inst.file ?? m.rootFile,
      x: mouse.current.x, y: mouse.current.y,
      connA: portConn(src, c.sourceHandle), connB: portConn(tgt, c.targetHandle),
    });
  }, []);
  const isValidConnection = useCallback((c: Connection | Edge) =>
    !(c.source === c.target && c.sourceHandle === c.targetHandle) && !c.source.includes(":") && !c.target.includes(":"), []);

  // ---------------------------------------------------------------- add device (palette drop / double-click)
  const addDevice = useCallback((modelId: string, at: { x: number; y: number }) => {
    const m = useProject.getState().model;
    const dm = useCatalog.getState().catalog.models.get(modelId);
    if (!m || !dm) return;
    const id = nextId(KIND_PREFIX[dm.kind] ?? "n-", [...m.nodes.map((n) => n.id), ...m.fibres.map((f) => f.id)]);
    const file = smallestContaining(frameRects("fileFrame"), at.x, at.y)?.id ?? m.rootFile;
    const site = smallestContaining(frameRects("siteFrame"), at.x, at.y)?.id;
    const issues = useProject.getState().applyOps([{ op: "addNode", file, node: { id, model: modelId, ...(site ? { site } : {}) }, position: { x: at.x - NODE_W / 2, y: at.y - 20 } }]);
    if (!issues.some((i) => i.severity === "error")) useUi.getState().select([{ kind: "node", id }]);
  }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    const modelId = e.dataTransfer.getData(DND_MIME);
    if (!modelId) return;
    e.preventDefault();
    addDevice(modelId, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  }, [rf, addDevice]);
  const viewCentre = () => {
    const r = wrapper.current?.getBoundingClientRect();
    return rf.screenToFlowPosition({ x: (r?.left ?? 0) + (r?.width ?? 0) / 2, y: (r?.top ?? 0) + (r?.height ?? 0) / 2 });
  };

  // ---------------------------------------------------------------- toolbar actions
  const newFile = () => {
    const m = useProject.getState().model;
    if (!m) return;
    const name = window.prompt("New fragment file (relative to the project):", "new-file.yaml");
    if (!name) return;
    // model path = relative to the parent's directory (CONTRACT path conventions)
    const rel = name.endsWith(".yaml") || name.endsWith(".yml") ? name : `${name}.yaml`;
    const c = viewCentre();
    useProject.getState().applyOps([
      { op: "addFile", file: rel, label: rel.replace(/\.ya?ml$/, "") },
      { op: "setLayout", kind: "file", id: rel, rect: { x: c.x - 150, y: c.y - 100, w: 300, h: 200 } },
    ]);
  };
  const newSite = () => {
    const m = useProject.getState().model;
    if (!m) return;
    const id = window.prompt("New site id:", nextId("site", m.sites.map((s) => s.id)));
    if (!id) return;
    const c = viewCentre();
    const file = smallestContaining(frameRects("fileFrame"), c.x, c.y)?.id ?? m.rootFile;
    useProject.getState().applyOps([{ op: "addSite", file, site: { id }, rect: { x: c.x - 150, y: c.y - 100, w: 300, h: 200 } }]);
  };

  if (!model) return <div className="p-6 text-muted">No project loaded.</div>;

  return (
    <div className="h-full flex flex-col">
      <CanvasToolbar
        paletteOpen={paletteOpen}
        onTogglePalette={() => setPaletteOpen((v) => !v)}
        onNewFile={newFile}
        onNewSite={newSite}
        onFit={() => void rf.fitView({ duration: 300 })}
      />
      <div className="flex flex-1 min-h-0">
      {paletteOpen && <Palette onAdd={(id) => addDevice(id, viewCentre())} />}
      <div
        ref={wrapper}
        className="relative flex-1 min-w-0"
        onMouseMove={(e) => (mouse.current = { x: e.clientX, y: e.clientY })}
        onDragOver={(e) => { if (e.dataTransfer.types.includes(DND_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
        onDrop={onDrop}
      >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onSelectionChange={onSelectionChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        connectionMode={ConnectionMode.Loose}
        deleteKeyCode={null}
        elevateNodesOnSelect={false}
        elevateEdgesOnSelect={false}
        onlyRenderVisibleElements
        minZoom={0.05}
        colorMode="dark"
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#3a3c42" bgColor="#1b1c1f" />
        <Controls position="bottom-right" showInteractive={false} />
        <MiniMap position="top-right" pannable zoomable className="!w-40 !h-28" bgColor="#232428" maskColor="rgb(27 28 31 / 0.65)" maskStrokeColor="#f2c14e" maskStrokeWidth={1.5}
          nodeColor={(n) => (n.type === "device" ? (n.selected ? "#f2c14e" : "#5a5d66") : "transparent")}
          nodeStrokeColor={(n) => (n.type === "fileFrame" ? "rgb(63 216 210 / 0.35)" : n.type === "siteFrame" ? "#3a3c42" : "transparent")} />
      </ReactFlow>
      </div>
      </div>
      <PortTooltip />
      {pending && <ConnectPopover pending={pending} onClose={() => setPending(null)} />}
    </div>
  );
}
