import { useProject } from "../../store/projectStore";
import { useUi } from "../../store/uiStore";
import { useCatalog } from "../../store/catalogStore";
import { Row, Section, TextField, SelectField } from "./fields";
import { ElementIssues } from "./Inspector";
import { storageOf } from "../../lib/paths";

export function SiteInspector({ id }: { id: string }) {
  const model = useProject((s) => s.model)!;
  const apply = useProject((s) => s.applyOps);
  const select = useUi((s) => s.select);
  const site = model.sites.find((s) => s.id === id);
  if (!site) return <Section title="Site">Not found: {id}</Section>;
  const members = model.nodes.filter((n) => n.site === id);
  return (
    <>
      <Section title="site">
        <Row label="id"><TextField mono value={site.id} onCommit={(v) => { if (v) { apply([{ op: "renameId", kind: "site", from: id, to: v }]); select([{ kind: "site", id: v }]); } }} /></Row>
        <Row label="name"><TextField value={site.name} onCommit={(v) => apply([{ op: "updateSite", id, patch: { name: v } }])} /></Row>
        <Row label="description"><TextField value={site.description} onCommit={(v) => apply([{ op: "updateSite", id, patch: { description: v } }])} /></Row>
        <Row label="parent"><SelectField value={site.parent} allowEmpty="—" options={model.sites.filter((s) => s.id !== id).map((s) => s.id)} onChange={(v) => apply([{ op: "updateSite", id, patch: { parent: v } }])} /></Row>
        <Row label="file"><SelectField value={site.file} options={model.files.map((f) => ({ value: f.path, label: f.label ?? f.path }))} onChange={(v) => v && apply([{ op: "moveToFile", kind: "site", id, file: v }])} /></Row>
      </Section>
      <Section title={`Nodes (${members.length})`}>
        <ul className="font-mono text-[11px]">{members.map((n) => <li key={n.id}><button className="link" onClick={() => select([{ kind: "node", id: n.id }])}>{n.id}</button></li>)}</ul>
      </Section>
      <ElementIssues id={id} />
    </>
  );
}

export function FileInspector({ path }: { path: string }) {
  const model = useProject((s) => s.model)!;
  const dirty = useProject((s) => s.dirtyModel.includes(path));
  const apply = useProject((s) => s.applyOps);
  const { setYamlFile, setTab } = useUi.getState();
  const f = model.files.find((x) => x.path === path);
  if (!f) return <Section title="File">Not found: {path}</Section>;
  const n = model.nodes.filter((x) => x.file === path).length;
  const fb = model.fibres.filter((x) => x.file === path).length;
  const st = model.sites.filter((x) => x.file === path).length;
  const isRoot = path === model.rootFile;
  return (
    <>
      <Section title={isRoot ? "parent file" : "fragment file"}>
        <Row label="path"><span className="font-mono break-all">{path}{dirty && <span className="text-aqua" title="unsaved changes"> ●</span>}</span></Row>
        <Row label="label"><span>{f.label ?? "—"}</span></Row>
        <Row label="contents"><span>{n} nodes, {fb} fibres, {st} sites</span></Row>
        <div className="mt-1 flex gap-1">
          <button className="btn" onClick={() => { setYamlFile(path); setTab("yaml"); }}>Open YAML</button>
          {!isRoot && <button className="btn-danger" disabled={n + fb + st > 0} title={n + fb + st > 0 ? "Move its elements out first" : ""} onClick={() => apply([{ op: "removeFile", file: path }])}>Remove file</button>}
        </div>
      </Section>
      <ElementIssues id={storageOf(model.rootFile, path)} />
    </>
  );
}

export function ProjectInspector() {
  const model = useProject((s) => s.model)!;
  const apply = useProject((s) => s.applyOps);
  const plans = useCatalog((s) => s.catalog.plans);
  const select = useUi((s) => s.select);
  const meta = model.project;
  return (
    <>
      <Section title="project">
        <Row label="name"><TextField value={meta.name} onCommit={(v) => v && apply([{ op: "setProjectMeta", patch: { name: v } }])} /></Row>
        <Row label="description"><TextField value={meta.description} onCommit={(v) => apply([{ op: "setProjectMeta", patch: { description: v } }])} /></Row>
        <Row label="plans">
          <div className="flex flex-wrap gap-1">
            {[...plans.keys()].map((p) => {
              const on = meta.wavelength_plans?.includes(p) ?? false;
              return (
                <label key={p} className="flex items-center gap-0.5">
                  <input type="checkbox" checked={on} onChange={() => apply([{ op: "setProjectMeta", patch: { wavelength_plans: on ? meta.wavelength_plans!.filter((x) => x !== p) : [...(meta.wavelength_plans ?? []), p] } }])} />
                  <span className="font-mono text-[10px]">{p}</span>
                </label>
              );
            })}
          </div>
        </Row>
        <Row label="root file"><span className="font-mono break-all">{model.rootFile}</span></Row>
      </Section>
      <Section title={`Files (${model.files.length})`}>
        <ul>
          {model.files.map((f) => (
            <li key={f.path}><button className="link font-mono text-[11px] text-left break-all" onClick={() => select([{ kind: "file", id: f.path }])}>{f.label ? `${f.label} — ` : ""}{f.path}</button></li>
          ))}
        </ul>
      </Section>
      <Section title="Counts">
        <div>{model.nodes.length} nodes · {model.fibres.length} fibres · {model.sites.length} sites</div>
      </Section>
    </>
  );
}
