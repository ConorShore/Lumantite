import { useCallback, useEffect, useMemo, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { monaco, uriFor, configureSchemas, MONACO_THEME } from "./monacoSetup";
import { useProject } from "../../store/projectStore";
import { useUi } from "../../store/uiStore";
import { useAllIssues } from "../../store/hooks";
import { minimalEdit } from "../../lib/textDiff";
import { storageOf } from "../../lib/paths";

type Editor = Parameters<OnMount>[0];
const DEBOUNCE_MS = 300;

export default function YamlTab() {
  const model = useProject((s) => s.model);
  const fileTexts = useProject((s) => s.fileTexts);
  const dirty = useProject((s) => s.dirtyModel);
  const setFileText = useProject((s) => s.setFileText);
  const selected = useUi((s) => s.yamlFile);
  const setYamlFile = useUi((s) => s.setYamlFile);
  const issues = useAllIssues();
  const editorRef = useRef<Editor | null>(null);
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** True while we write external text into Monaco, so onChange doesn't echo it back. */
  const applyingExternal = useRef(false);

  const files = useMemo(() => model?.files ?? [], [model]);
  const file = files.some((f) => f.path === selected) ? selected! : model?.rootFile ?? "";
  const text = fileTexts[file] ?? "";

  useEffect(() => {
    if (model) configureSchemas(model.rootFile, files.map((f) => f.path));
  }, [model?.rootFile, files]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Push editor text of `path` into the session now (cancels the debounce). */
  const flush = useCallback((path: string) => {
    const t = pending.current.get(path);
    if (t === undefined) return;
    clearTimeout(t);
    pending.current.delete(path);
    const m = monaco.editor.getModel(monaco.Uri.parse(uriFor(path)));
    if (m) setFileText(path, m.getValue());
  }, [setFileText]);

  const onChange = useCallback((value: string | undefined) => {
    if (applyingExternal.current) return;
    const path = file;
    const old = pending.current.get(path);
    if (old) clearTimeout(old);
    pending.current.set(path, setTimeout(() => {
      pending.current.delete(path);
      setFileText(path, value ?? "");
    }, DEBOUNCE_MS));
  }, [file, setFileText]);

  // External changes (canvas ops, reload) → minimal edit into the model, keeping cursor and undo stack.
  useEffect(() => {
    const ed = editorRef.current;
    const m = monaco.editor.getModel(monaco.Uri.parse(uriFor(file)));
    if (!m || pending.current.has(file)) return;
    const edit = minimalEdit(m.getValue(), text);
    if (!edit) return;
    const s = m.getPositionAt(edit.start);
    const e = m.getPositionAt(edit.end);
    const op = { range: new monaco.Range(s.lineNumber, s.column, e.lineNumber, e.column), text: edit.text, forceMoveMarkers: false };
    applyingExternal.current = true;
    try {
      if (ed && ed.getModel() === m) ed.executeEdits("lumantite", [op]);
      else m.pushEditOperations([], [op], () => null);
    } finally {
      applyingExternal.current = false;
    }
  }, [file, text]);

  // Engine / session issues as markers on the line declaring the element.
  useEffect(() => {
    const m = monaco.editor.getModel(monaco.Uri.parse(uriFor(file)));
    if (!m || !model) return;
    const inFile = new Set([...model.nodes, ...model.fibres, ...model.sites].filter((x) => x.file === file).map((x) => x.id));
    const markers: Parameters<typeof monaco.editor.setModelMarkers>[2] = [];
    for (const i of issues) {
      const stored = storageOf(model.rootFile, file);
      const isFileIssue = i.element === file || i.element === stored;
      if (!i.element || (!inFile.has(i.element) && !isFileIssue)) continue;
      let line = 1;
      if (!isFileIssue) {
        const re = new RegExp(`id:\\s*["']?${i.element.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?\\s*[,}\\n]`);
        const hit = re.exec(m.getValue() + "\n");
        if (hit) line = m.getPositionAt(hit.index).lineNumber;
      }
      markers.push({
        severity: i.severity === "error" ? monaco.MarkerSeverity.Error : i.severity === "warn" ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
        message: `${i.code}: ${i.message}`, startLineNumber: line, endLineNumber: line, startColumn: 1, endColumn: m.getLineMaxColumn(line),
      });
    }
    monaco.editor.setModelMarkers(m, "lumantite", markers);
  }, [issues, file, model, text]);

  const onMount: OnMount = (ed) => {
    editorRef.current = ed;
    ed.onDidBlurEditorText(() => { const p = ed.getModel()?.uri.path.slice(1); if (p) flush(p); });
  };

  if (!model) return <div className="p-6 text-muted">No project loaded.</div>;
  const issueCount = (p: string) => { const st = storageOf(model.rootFile, p); return issues.filter((i) => i.element === p || i.element === st).length; };

  return (
    <div className="h-full flex flex-col">
      <div className="flex h-7 items-end gap-1 border-b border-line bg-surface px-2 overflow-x-auto" role="tablist" aria-label="Project files">
        {files.map((f) => (
          <button
            key={f.path}
            role="tab"
            aria-selected={f.path === file}
            className={`-mb-px whitespace-nowrap border-b-2 px-2 py-0.5 font-mono text-[11px] ${f.path === file ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg hover:border-line"}`}
            onClick={() => { flush(file); setYamlFile(f.path); }}
            title={f.label}
          >
            {f.path === model.rootFile && <span className="text-accent">★ </span>}{f.path}
            {dirty.includes(f.path) && <span className="text-aqua" title="unsaved changes"> ●</span>}
            {issueCount(f.path) > 0 && <span className="text-fail"> ({issueCount(f.path)})</span>}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 bg-page">
        <Editor
          theme={MONACO_THEME}
          path={uriFor(file)}
          defaultLanguage="yaml"
          defaultValue={text}
          onMount={onMount}
          onChange={onChange}
          options={{ minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2, quickSuggestions: { strings: true, other: true, comments: false } }}
        />
      </div>
    </div>
  );
}
