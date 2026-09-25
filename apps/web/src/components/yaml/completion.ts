/** Completion of model ids, fibre types, joints, sites, hosts, channels and `node.port` endpoints. */
import type * as Monaco from "monaco-editor";
import { portsOf } from "../../adapters/engine";
import { useCatalog } from "../../store/catalogStore";
import { useProject } from "../../store/projectStore";

type Suggest = { label: string; detail?: string };

function candidates(key: string): Suggest[] {
  const { catalog } = useCatalog.getState();
  const model = useProject.getState().model;
  const models = [...catalog.models.values()];
  switch (key) {
    case "model": return models.filter((m) => m.kind !== "fibre" && m.kind !== "joint").map((m) => ({ label: m.id, detail: m.kind }));
    case "type": return models.filter((m) => m.kind === "fibre").map((m) => ({ label: m.id, detail: "fibre" }));
    case "joint": return models.filter((m) => m.kind === "joint").map((m) => ({ label: m.id, detail: "joint" }));
    case "extends": return models.map((m) => ({ label: m.id, detail: m.kind }));
    case "site": case "parent": return model?.sites.map((s) => ({ label: s.id, detail: s.name ?? "site" })) ?? [];
    case "host": return model?.nodes.filter((n) => catalog.models.get(n.model)?.kind === "host").map((n) => ({ label: n.id, detail: "host" })) ?? [];
    case "channel": return (model?.project.wavelength_plans ?? [...catalog.plans.keys()]).flatMap((p) => catalog.channels(p).map((c) => ({ label: c.id, detail: `${p} ${c.wavelength_nm.toFixed(2)} nm` })));
    case "to": {
      const out: Suggest[] = [];
      for (const n of model?.nodes ?? []) {
        const m = catalog.models.get(n.model);
        if (m) for (const [p, spec] of Object.entries(portsOf(m, catalog))) out.push({ label: `${n.id}.${p}`, detail: `${spec.direction}${spec.channel ? ` ${spec.channel}` : ""}` });
      }
      for (const f of model?.fibres ?? []) out.push({ label: `${f.id}.a`, detail: "fibre end" }, { label: `${f.id}.b`, detail: "fibre end" });
      return out;
    }
    default: return [];
  }
}

export function registerCompletions(monaco: typeof Monaco): void {
  monaco.languages.registerCompletionItemProvider("yaml", {
    triggerCharacters: [" ", ".", ":"],
    provideCompletionItems(model, position) {
      const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const m = /\b(model|type|joint|extends|site|parent|host|channel|to):\s*["']?([\w.:-]*)$/.exec(before);
      if (!m) return { suggestions: [] };
      const partial = m[2]!;
      const range = new monaco.Range(position.lineNumber, position.column - partial.length, position.lineNumber, position.column);
      return {
        suggestions: candidates(m[1]!).map((s) => ({
          label: s.label, detail: s.detail, insertText: s.label, range,
          kind: monaco.languages.CompletionItemKind.Value,
        })),
      };
    },
  });
}
