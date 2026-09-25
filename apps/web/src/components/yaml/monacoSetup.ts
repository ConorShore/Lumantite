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
      { uri: "inmemory://optiplanner/project.schema.json", fileMatch: [uriFor(rootFile)], schema: project },
      { uri: "inmemory://optiplanner/fragment.schema.json", fileMatch: files.filter((f) => f !== rootFile).map(uriFor), schema: fragment },
    ],
  };
  if (!yamlHandle) yamlHandle = configureMonacoYaml(monaco, opts);
  else void yamlHandle.update(opts);
  if (!registered) { registered = true; registerCompletions(monaco); }
}

export { monaco };
