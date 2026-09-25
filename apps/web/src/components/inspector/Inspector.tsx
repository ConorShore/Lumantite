import { useMemo } from "react";
import { useUi } from "../../store/uiStore";
import { useProject } from "../../store/projectStore";
import { useAllIssues } from "../../store/hooks";
import { deleteSelection } from "../../store/actions";
import { issuesByElement } from "../../store/selectors";
import { SEVERITY_CLASS } from "../../lib/status";
import type { Issue } from "@optiplanner/schema";
import { NodeInspector } from "./NodeInspector";
import { FibreInspector } from "./FibreInspector";
import { SiteInspector, FileInspector, ProjectInspector } from "./OtherInspectors";
import { Section, Row, SelectField } from "./fields";

export function Inspector() {
  const selection = useUi((s) => s.selection);
  const model = useProject((s) => s.model);
  const body = (() => {
    if (!model) return null;
    if (!selection.length) return <ProjectInspector />;
    if (selection.length > 1) return <MultiInspector />;
    const s = selection[0]!;
    if (s.kind === "node") return <NodeInspector id={s.id} />;
    if (s.kind === "fibre") return <FibreInspector id={s.id} />;
    if (s.kind === "site") return <SiteInspector id={s.id} />;
    return <FileInspector path={s.id} />;
  })();
  return (
    <aside className="w-72 shrink-0 overflow-auto bg-white" aria-label="Inspector">
      <div className="h-7 flex items-center px-2 border-b border-slate-200 bg-slate-50 font-medium">Inspector</div>
      {body}
    </aside>
  );
}

function MultiInspector() {
  const selection = useUi((s) => s.selection);
  const model = useProject((s) => s.model)!;
  const apply = useProject((s) => s.applyOps);
  const movable = selection.filter((s) => s.kind !== "file") as { kind: "node" | "fibre" | "site"; id: string }[];
  return (
    <Section title={`${selection.length} selected`}>
      <ul className="mb-2 max-h-40 overflow-auto font-mono text-[11px]">{selection.map((s) => <li key={`${s.kind}:${s.id}`}>{s.kind} {s.id}</li>)}</ul>
      <Row label="Move to file">
        <SelectField
          value={undefined}
          allowEmpty="—"
          options={model.files.map((f) => ({ value: f.path, label: f.label ?? f.path }))}
          onChange={(file) => file && apply(movable.map((s) => ({ op: "moveToFile", kind: s.kind, id: s.id, file })))}
        />
      </Row>
      <button className="mt-2 rounded border border-red-300 px-2 text-red-700" onClick={deleteSelection}>Delete selected</button>
    </Section>
  );
}

export function ElementIssues({ id }: { id: string }) {
  const all = useAllIssues();
  const issues: Issue[] = useMemo(() => issuesByElement(all).get(id) ?? [], [all, id]);
  if (!issues.length) return null;
  return (
    <Section title={`Issues (${issues.length})`}>
      <ul className="space-y-0.5">
        {issues.map((i, n) => <li key={n} className={SEVERITY_CLASS[i.severity]}><b>{i.severity}</b> {i.message}</li>)}
      </ul>
    </Section>
  );
}
