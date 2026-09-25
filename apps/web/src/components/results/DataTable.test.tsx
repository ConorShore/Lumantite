import { describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { DataTable, type Column } from "./DataTable";

type Row = { id: string; v: number };
const cols: Column<Row>[] = [
  { key: "id", header: "id", value: (r) => r.id },
  { key: "v", header: "v", value: (r) => r.v, align: "right" },
];

async function render(rows: Row[]) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => root.render(<DataTable rows={rows} columns={cols} rowKey={(r) => r.id} />));
  return { el, root };
}

describe("DataTable", () => {
  it("renders every row below 500 and sorts on header click", async () => {
    const { el, root } = await render([{ id: "b", v: 2 }, { id: "a", v: 3 }, { id: "c", v: 1 }]);
    expect(el.querySelectorAll("tbody tr")).toHaveLength(3);
    await act(async () => (el.querySelectorAll("th")[1] as HTMLElement).click());
    expect([...el.querySelectorAll("tbody tr td:first-child")].map((t) => t.textContent)).toEqual(["c", "b", "a"]);
    await act(async () => root.unmount());
  });

  it("virtualises above 500 rows", async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ id: `r${i}`, v: i }));
    const { el, root } = await render(rows);
    const rendered = el.querySelectorAll("tbody tr").length;
    expect(rendered).toBeLessThan(200);
    expect(el.textContent).toContain("(virtualised)");
    await act(async () => root.unmount());
  });
});
