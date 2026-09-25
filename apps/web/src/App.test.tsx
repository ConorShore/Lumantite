import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { bootstrap } from "./store/actions";
import { useProject, useResults } from "./store";

afterEach(() => vi.unstubAllGlobals());

describe("app shell", () => {
  it("renders top bar, tabs, canvas, inspector and issues with the offline sample", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    const el = document.createElement("div");
    el.style.width = "1200px";
    el.style.height = "800px";
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(<App />); });
    await act(async () => { await bootstrap(); await useResults.getState().recomputeNow(); });

    expect(useProject.getState().model).not.toBeNull();
    expect(el.querySelector('[data-testid="project-name"]')?.textContent).toContain("Metro ring east");
    const tabs = [...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
    expect(tabs).toEqual(expect.arrayContaining(["Canvas", "YAML", "Catalog", "Margins", "Results", "Exports"]));
    expect((el.querySelector('[aria-label="Inspector"] input') as HTMLInputElement).value).toContain("Metro ring east");
    expect(el.querySelector('[aria-label="Issues"]')?.textContent).toMatch(/rx\.power/);
    // status counts in the top bar
    expect(el.textContent).toMatch(/\d+pass/i);

    // switch tabs that don't need a real layout engine
    for (const name of ["Results", "Margins", "Exports", "Catalog"]) {
      const tab = [...el.querySelectorAll('[role="tab"]')].find((t) => t.textContent === name) as HTMLButtonElement;
      await act(async () => { tab.click(); });
    }
    expect(el.textContent).toContain("Save catalog");
    // open a catalog entry in the editor (guards against unstable zustand selectors → render loops)
    const { useUi: ui } = await import("./store");
    await act(async () => { ui.getState().setCatalogView("transceiver", "generic-10g-dwdm-80km"); });
    expect((el.querySelector('input[aria-label="id"]') as HTMLInputElement).value).toBe("generic-10g-dwdm-80km");
    expect(el.textContent).toContain("sensitivity_dBm");

    // Escape clears selection, Delete removes the selected node
    const { useUi } = await import("./store");
    await act(async () => { useUi.getState().setTab("canvas"); useUi.getState().select([{ kind: "node", id: "A-sw1" }]); });
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" })); });
    expect(useProject.getState().model!.nodes.some((n) => n.id === "A-sw1")).toBe(false);
    await act(async () => { useUi.getState().select([{ kind: "node", id: "A-mux" }]); });
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(useUi.getState().selection).toEqual([]);

    await act(async () => root.unmount());
  });
});
