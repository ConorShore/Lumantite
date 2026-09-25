import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import { configureMonacoYaml, type MonacoYaml } from "monaco-yaml";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import YamlWorker from "./yaml.worker?worker";
import { projectJsonSchemas } from "../../lib/jsonSchemas";
import { registerCompletions } from "./completion";

window.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    return label === "yaml" ? new YamlWorker() : new EditorWorker();
  },
};
loader.config({ monaco });

/** Dark editor theme matching the app palette (index.css): grey surfaces, gold accent, aqua info. */
export const MONACO_THEME = "lumantite-dark";
monaco.editor.defineTheme(MONACO_THEME, {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "", foreground: "e6e6e6" },
    { token: "comment", foreground: "7d8089", fontStyle: "italic" },
    { token: "type", foreground: "f2c14e" }, // YAML keys
    { token: "string", foreground: "d7d9de" },
    { token: "number", foreground: "6ee7e2" },
    { token: "keyword", foreground: "c9a7ff" }, // true / false / null
    { token: "operators", foreground: "9a9ca3" },
    { token: "delimiter", foreground: "9a9ca3" },
    { token: "tag", foreground: "c9a7ff" },
  ],
  colors: {
    "editor.background": "#1b1c1f",
    "editor.foreground": "#e6e6e6",
    "editorLineNumber.foreground": "#5d6068",
    "editorLineNumber.activeForeground": "#f2c14e",
    "editorCursor.foreground": "#f2c14e",
    "editor.lineHighlightBackground": "#232428",
    "editor.lineHighlightBorder": "#00000000",
    "editor.selectionBackground": "#f2c14e40",
    "editor.inactiveSelectionBackground": "#f2c14e22",
    "editor.selectionHighlightBackground": "#f2c14e1a",
    "editor.wordHighlightBackground": "#3fd8d21a",
    "editor.findMatchBackground": "#3fd8d255",
    "editor.findMatchHighlightBackground": "#3fd8d22a",
    "editorIndentGuide.background1": "#2e3034",
    "editorIndentGuide.activeBackground1": "#4a4d55",
    "editorWhitespace.foreground": "#3a3c42",
    "editorBracketMatch.background": "#f2c14e22",
    "editorBracketMatch.border": "#f2c14e88",
    "editorGutter.background": "#1b1c1f",
    "editorWidget.background": "#232428",
    "editorWidget.border": "#3a3c42",
    "editorHoverWidget.background": "#2b2d31",
    "editorHoverWidget.border": "#3a3c42",
    "editorSuggestWidget.background": "#2b2d31",
    "editorSuggestWidget.border": "#3a3c42",
    "editorSuggestWidget.foreground": "#e6e6e6",
    "editorSuggestWidget.selectedBackground": "#f2c14e26",
    "editorSuggestWidget.highlightForeground": "#f2c14e",
    "list.hoverBackground": "#33353a",
    "list.highlightForeground": "#f2c14e",
    "input.background": "#1b1c1f",
    "input.border": "#3a3c42",
    "focusBorder": "#f2c14e",
    "editorError.foreground": "#f87171",
    "editorWarning.foreground": "#fb923c",
    "editorInfo.foreground": "#3fd8d2",
    "editorOverviewRuler.errorForeground": "#f87171",
    "editorOverviewRuler.warningForeground": "#fb923c",
    "editorOverviewRuler.infoForeground": "#3fd8d2",
    "editorOverviewRuler.border": "#00000000",
    "scrollbarSlider.background": "#3a3c4299",
    "scrollbarSlider.hoverBackground": "#4a4d55cc",
    "scrollbarSlider.activeBackground": "#f2c14e66",
  },
});

export const uriFor = (path: string) => `file:///${path}`;

let yamlHandle: MonacoYaml | null = null;
let registered = false;

/** (Re)associate the project / fragment JSON schemas with the current project's files. */
export function configureSchemas(rootFile: string, files: string[]): void {
  const { project, fragment } = projectJsonSchemas();
  const opts = {
    enableSchemaRequest: false,
    hover: true,
    completion: true,
    validate: true,
    format: { enable: false },
    schemas: [
      { uri: "inmemory://lumantite/project.schema.json", fileMatch: [uriFor(rootFile)], schema: project },
      { uri: "inmemory://lumantite/fragment.schema.json", fileMatch: files.filter((f) => f !== rootFile).map(uriFor), schema: fragment },
    ],
  };
  if (!yamlHandle) yamlHandle = configureMonacoYaml(monaco, opts);
  else void yamlHandle.update(opts);
  if (!registered) { registered = true; registerCompletions(monaco); }
}

export { monaco };
