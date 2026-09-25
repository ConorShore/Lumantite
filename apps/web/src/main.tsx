import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./index.css";
import { App } from "./App";
import { bootstrap } from "./store/actions";
import { useProject, useCatalog, useResults, useUi } from "./store";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
void bootstrap();

// Dev-only handle for debugging from the console.
if (import.meta.env.DEV) Object.assign(window, { __optiplanner: { useProject, useCatalog, useResults, useUi } });
