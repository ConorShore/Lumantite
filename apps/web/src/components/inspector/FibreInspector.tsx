import { useMemo } from "react";
import type { FibreInst } from "@optiplanner/schema";
import { portsOf } from "../../adapters/engine";
import { useProject } from "../../store/projectStore";
import { useCatalog } from "../../store/catalogStore";
import { useResults } from "../../store/resultsStore";
import { useUi } from "../../store/uiStore";
import { dB, triple } from "../../lib/format";
import { StatusBadge } from "../common/StatusBadge";
import { Row, Section, TextField, NumberField, SelectField } from "./fields";
import { ElementIssues } from "./Inspector";

export function FibreInspector({ id }: { id: string }) {
  const model = useProject((s) => s.model)!;
  const apply = useProject((s) => s.applyOps);
  const catalog = useCatalog((s) => s.catalog);
  const results = useResults((s) => s.results);
  const select = useUi((s) => s.select);
  const f = model.fibres.find((x) => x.id === id);
  const fibreTypes = useMemo(() => [...catalog.models.values()].filter((m) => m.kind === "fibre").map((m) => m.id), [catalog]);
  const joints = useMemo(() => [...catalog.models.values()].filter((m) => m.kind === "joint").map((m) => m.id), [catalog]);
  const endpoints = useMemo(() => {
    const out: string[] = [];
    for (const n of model.nodes) { const m = catalog.models.get(n.model); if (m) for (const p of Object.keys(portsOf(m, catalog))) out.push(`${n.id}.${p}`); }
    for (const x of model.fibres) out.push(`${x.id}.a`, `${x.id}.b`);
    return out;
  }, [model, catalog]);
  if (!f) return <Section title="Fibre">Not found: {id}</Section>;

  const patch = (p: Partial<FibreInst>) => apply([{ op: "updateFibre", id, patch: p }]);
  const t = catalog.models.get(f.type);
  const fr = results?.fibres.find((x) => x.id === id);
  const status = results?.elementStatus[id] ?? "n/a";

  return (
    <>
      <Section title="fibre" right={<StatusBadge status={status} />}>
        <Row label="id"><TextField mono value={f.id} onCommit={(v) => { if (v) { apply([{ op: "renameId", kind: "fibre", from: id, to: v }]); select([{ kind: "fibre", id: v }]); } }} /></Row>
        <Row label="type"><SelectField value={f.type} options={fibreTypes} onChange={(v) => v && patch({ type: v })} /></Row>
        <Row label="length km"><NumberField value={f.length_km} placeholder={t?.kind === "fibre" && t.default_length_km !== undefined ? `default ${t.default_length_km}` : ""} onCommit={(v) => patch({ length_km: v })} /></Row>
        <Row label="file"><SelectField value={f.file} options={model.files.map((x) => ({ value: x.path, label: x.label ?? x.path }))} onChange={(v) => v && apply([{ op: "moveToFile", kind: "fibre", id, file: v }])} /></Row>
        <datalist id="endpoints">{endpoints.map((e) => <option key={e} value={e} />)}</datalist>
        {(["a", "b"] as const).map((end) => (
          <div key={end} className="mt-1 rounded bg-slate-50 px-1">
            <Row label={`${end}.to`}><TextField mono list="endpoints" value={f[end]?.to} onCommit={(v) => patch({ [end]: { to: v } } as Partial<FibreInst>)} /></Row>
            <Row label={`${end}.joint`}><SelectField value={f[end]?.joint} allowEmpty={`(default ${t?.kind === "fibre" ? t.default_joint ?? "port" : "?"})`} options={joints} onChange={(v) => patch({ [end]: { joint: v } } as Partial<FibreInst>)} /></Row>
          </div>
        ))}
      </Section>
      <Section title="Overrides">
        <Row label="att dB/km"><NumberField value={f.attenuation_dB_per_km} placeholder="from type" onCommit={(v) => patch({ attenuation_dB_per_km: v })} /></Row>
        <Row label="disp ps/nm·km"><NumberField value={f.dispersion_ps_nm_km} placeholder="from type" onCommit={(v) => patch({ dispersion_ps_nm_km: v })} /></Row>
        <Row label="extra loss dB"><NumberField value={f.extra_loss_dB} onCommit={(v) => patch({ extra_loss_dB: v })} /></Row>
      </Section>
      {fr && (
        <Section title="Results">
          <Row label="loss dB"><span className="tabular-nums">{triple(fr.loss)}</span></Row>
          {fr.directions.map((d) => (
            <Row key={d.direction} label={d.direction}>
              <span className="tabular-nums">{d.channels.length} ch, total {dB(d.totalPower?.typ)} dBm <StatusBadge status={d.status} /></span>
            </Row>
          ))}
        </Section>
      )}
      <ElementIssues id={id} />
    </>
  );
}
