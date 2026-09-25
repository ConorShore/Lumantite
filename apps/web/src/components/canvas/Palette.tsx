import { useMemo, useState } from "react";
import { useCatalog } from "../../store/catalogStore";

export const DND_MIME = "application/x-lumantite-model";
const PALETTE_KINDS = ["transceiver", "mux", "amplifier", "attenuator", "dcm", "splitter", "passthrough", "host"];

export function Palette({ onAdd }: { onAdd(modelId: string): void }) {
  const catalog = useCatalog((s) => s.catalog);
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const out: [string, string[]][] = [];
    for (const kind of PALETTE_KINDS) {
      const ids = [...catalog.models.values()].filter((m) => m.kind === kind && (!q || m.id.toLowerCase().includes(q.toLowerCase()))).map((m) => m.id).sort();
      if (ids.length) out.push([kind, ids]);
    }
    return out;
  }, [catalog, q]);
  return (
    <div className="w-48 shrink-0 flex flex-col border-r border-slate-200 bg-slate-50" aria-label="Device palette">
      <input className="m-1 rounded border px-1" placeholder="Search models…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex-1 overflow-auto pb-1">
        {groups.map(([kind, ids]) => (
          <div key={kind}>
            <div className="sticky top-0 bg-slate-100 px-2 text-[10px] font-semibold uppercase text-slate-500">{kind}</div>
            {ids.map((id) => (
              <div
                key={id}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData(DND_MIME, id); e.dataTransfer.effectAllowed = "copy"; }}
                onDoubleClick={() => onAdd(id)}
                className="cursor-grab truncate px-2 font-mono text-[10px] hover:bg-sky-50"
                title={`${id} — drag onto the canvas (double-click adds at centre)`}
              >
                {id}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
