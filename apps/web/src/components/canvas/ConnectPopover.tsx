import { useMemo, useState } from "react";
import type { FibreModel } from "@optiplanner/schema";
import { useCatalog } from "../../store/catalogStore";
import { useProject } from "../../store/projectStore";
import { nextId } from "../../lib/ids";

export interface PendingConnection { a: string; b: string; file: string; x: number; y: number; connA?: string; connB?: string }

export function ConnectPopover({ pending, onClose }: { pending: PendingConnection; onClose(): void }) {
  const catalog = useCatalog((s) => s.catalog);
  const model = useProject((s) => s.model);
  const fibres = useMemo(() => [...catalog.models.values()].filter((m): m is FibreModel => m.kind === "fibre"), [catalog]);
  const joints = useMemo(() => [...catalog.models.values()].filter((m) => m.kind === "joint").map((m) => m.id), [catalog]);
  const [type, setType] = useState(fibres.find((f) => f.default_length_km !== undefined)?.id ?? fibres[0]?.id ?? "");
  const t = fibres.find((f) => f.id === type);
  const [length, setLength] = useState<string>("");
  const [jointA, setJointA] = useState<string>("");
  const [jointB, setJointB] = useState<string>("");
  const [file, setFile] = useState(pending.file);
  const dflt = (conn?: string) => t?.default_joint ?? conn ?? joints[0] ?? "";
  const reused = model?.fibres.filter((f) => [f.a.to, f.b.to].some((to) => to === pending.a || to === pending.b)).map((f) => f.id) ?? [];

  const create = () => {
    if (!model || !type) return;
    const id = nextId("f", [...model.fibres.map((f) => f.id), ...model.nodes.map((n) => n.id)]);
    const len = length.trim() === "" ? undefined : Number(length);
    const ja = jointA || undefined;
    const jb = jointB || undefined;
    useProject.getState().applyOps([{
      op: "addFibre", file,
      fibre: { id, type, ...(len !== undefined && Number.isFinite(len) ? { length_km: len } : {}), a: { ...(ja ? { joint: ja } : {}), to: pending.a }, b: { ...(jb ? { joint: jb } : {}), to: pending.b } },
    }]);
    onClose();
  };

  return (
    <div
      className="fixed z-50 w-64 rounded border border-slate-300 bg-white p-2 shadow-xl"
      style={{ left: Math.min(pending.x, window.innerWidth - 270), top: Math.min(pending.y, window.innerHeight - 260) }}
      role="dialog"
      aria-label="New fibre"
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); if (e.key === "Enter") create(); }}
    >
      <div className="mb-1 font-semibold">New fibre</div>
      <div className="mb-1 font-mono text-[10px] text-slate-600">{pending.a} → {pending.b}</div>
      {reused.length > 0 && <div className="mb-1 text-[10px] text-amber-700">Port already used by {reused.join(", ")}</div>}
      <label className="block mb-1">Type
        <select autoFocus className="w-full rounded border px-1" value={type} onChange={(e) => setType(e.target.value)}>
          {fibres.map((f) => <option key={f.id} value={f.id}>{f.id}{f.default_length_km !== undefined ? " (patch)" : ""}</option>)}
        </select>
      </label>
      <label className="block mb-1">Length km
        <input className="w-full rounded border px-1" type="number" step="any" min={0} value={length} placeholder={t?.default_length_km !== undefined ? `default ${t.default_length_km}` : "required for spans"} onChange={(e) => setLength(e.target.value)} />
      </label>
      <div className="flex gap-1">
        <label className="flex-1">Joint a
          <select className="w-full rounded border px-1" value={jointA} onChange={(e) => setJointA(e.target.value)}>
            <option value="">default ({dflt(pending.connA)})</option>
            {joints.map((j) => <option key={j}>{j}</option>)}
          </select>
        </label>
        <label className="flex-1">Joint b
          <select className="w-full rounded border px-1" value={jointB} onChange={(e) => setJointB(e.target.value)}>
            <option value="">default ({dflt(pending.connB)})</option>
            {joints.map((j) => <option key={j}>{j}</option>)}
          </select>
        </label>
      </div>
      <label className="block mt-1">File
        <select className="w-full rounded border px-1" value={file} onChange={(e) => setFile(e.target.value)}>
          {model?.files.map((f) => <option key={f.path} value={f.path}>{f.label ?? f.path}</option>)}
        </select>
      </label>
      <div className="mt-2 flex justify-end gap-1">
        <button className="rounded border px-2" onClick={onClose}>Cancel</button>
        <button className="rounded bg-sky-600 px-2 text-white" onClick={create} disabled={!type}>Create</button>
      </div>
    </div>
  );
}
