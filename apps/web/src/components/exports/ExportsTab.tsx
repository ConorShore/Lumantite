import { useMemo, useState } from "react";
import { toPortsCsv, toSignalsCsv, toMarkdown } from "../../adapters/engine";
import { useResults } from "../../store/resultsStore";
import { useProject } from "../../store/projectStore";
import { useConfig } from "../../store/configStore";
import { downloadText } from "../../lib/download";

type Kind = "ports" | "signals" | "markdown";
const META: Record<Kind, { label: string; ext: string; mime: string }> = {
  ports: { label: "Ports CSV", ext: "ports.csv", mime: "text/csv" },
  signals: { label: "Signals CSV", ext: "signals.csv", mime: "text/csv" },
  markdown: { label: "Markdown report", ext: "report.md", mime: "text/markdown" },
};

export function ExportsTab() {
  const results = useResults((s) => s.results);
  const model = useProject((s) => s.model);
  const delimiter = useConfig((s) => s.config.export.csv_delimiter);
  const [kind, setKind] = useState<Kind>("signals");
  const text = useMemo(() => {
    if (!results || !model) return "";
    if (kind === "ports") return toPortsCsv(results, delimiter);
    if (kind === "signals") return toSignalsCsv(results, delimiter);
    return toMarkdown(model, results);
  }, [results, model, kind, delimiter]);
  if (!results || !model) return <div className="p-6 text-muted">No results to export yet.</div>;
  const base = model.rootFile.replace(/\/?project\.ya?ml$/, "").replace(/\.ya?ml$/, "").replace(/\//g, "-") || "project";
  const filename = `${base}-${META[kind].ext}`;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-line bg-surface px-2 py-1">
        {(Object.keys(META) as Kind[]).map((k) => (
          <button key={k} className={`seg ${k === kind ? "is-active" : ""}`} onClick={() => setKind(k)}>{META[k].label}</button>
        ))}
        <span className="ml-3 text-muted">{text.split("\n").length - 1} lines · {(text.length / 1024).toFixed(1)} KiB</span>
        <button className="btn-primary ml-auto py-0.5" onClick={() => downloadText(filename, text, META[kind].mime)}>Download {filename}</button>
        <button className="btn py-0.5" onClick={() => void navigator.clipboard?.writeText(text)}>Copy</button>
      </div>
      <pre className="flex-1 min-h-0 overflow-auto bg-page p-2 font-mono text-[11px] leading-4 text-fg" aria-label="Export preview">{text}</pre>
    </div>
  );
}
