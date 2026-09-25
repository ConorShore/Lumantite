/** Sortable, filterable table; virtualises (fixed row height) above 500 rows. */
import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  value(row: T): string | number | undefined;
  render?(row: T): ReactNode;
  align?: "right";
  width?: string;
}

const ROW_H = 20;
const VIRTUAL_OVER = 500;

export function DataTable<T>({ rows, columns, rowKey, renderExpanded, onRowClick, initialSort }: {
  rows: T[]; columns: Column<T>[]; rowKey(row: T): string;
  renderExpanded?(row: T): ReactNode; onRowClick?(row: T): void; initialSort?: { key: string; dir: 1 | -1 };
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(initialSort ?? null);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let out = q ? rows.filter((r) => columns.some((c) => String(c.value(r) ?? "").toLowerCase().includes(q))) : rows;
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) out = [...out].sort((a, b) => {
        const x = col.value(a), y = col.value(b);
        if (x === y) return 0;
        if (x === undefined) return 1;
        if (y === undefined) return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir;
      });
    }
    return out;
  }, [rows, columns, sort, filter]);

  const virtual = shown.length > VIRTUAL_OVER;
  const viewH = scroller.current?.clientHeight ?? 600;
  const first = virtual ? Math.max(0, Math.floor(scrollTop / ROW_H) - 10) : 0;
  const last = virtual ? Math.min(shown.length, first + Math.ceil(viewH / ROW_H) + 20) : shown.length;
  const expandedRow = expanded ? shown.find((r) => rowKey(r) === expanded) : undefined;

  const clickRow = (r: T) => {
    onRowClick?.(r);
    if (renderExpanded) setExpanded((e) => (e === rowKey(r) ? null : rowKey(r)));
  };
  const header = (c: Column<T>) => (
    <th
      key={c.key}
      className={`sticky top-0 z-[1] cursor-pointer select-none whitespace-nowrap border-b border-line bg-raised px-1.5 py-0.5 font-medium hover:text-fg ${sort?.key === c.key ? "text-fg" : "text-muted"} ${c.align === "right" ? "text-right" : "text-left"}`}
      style={{ width: c.width }}
      onClick={() => setSort((s) => (s?.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }))}
      aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
    >
      {c.header}{sort?.key === c.key && <span className="text-accent" aria-hidden>{sort.dir === 1 ? " ▲" : " ▼"}</span>}
    </th>
  );
  const row = (r: T, i: number) => {
    const k = rowKey(r);
    return (
      <tr key={k} style={{ height: ROW_H }} className={`${renderExpanded || onRowClick ? "cursor-pointer" : ""} ${expanded === k ? "bg-accent/15 text-accent shadow-[inset_2px_0_0_var(--color-accent)]" : `${i % 2 ? "bg-surface" : "bg-page"} hover:bg-raised`}`} onClick={() => clickRow(r)}>
        {columns.map((c) => (
          <td key={c.key} className={`whitespace-nowrap px-1.5 ${c.align === "right" ? "text-right tabular-nums" : ""}`}>{c.render ? c.render(r) : c.value(r) ?? "–"}</td>
        ))}
      </tr>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-2 py-1">
        <input className="field w-64" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter rows" />
        <span className="text-muted">{shown.length} / {rows.length} rows{virtual ? " (virtualised)" : ""}</span>
      </div>
      <div ref={scroller} className="flex-1 min-h-0 overflow-auto bg-page" onScroll={(e) => virtual && setScrollTop(e.currentTarget.scrollTop)}>
        <table className="w-full border-separate border-spacing-0 text-[11px]">
          <thead><tr>{columns.map(header)}</tr></thead>
          <tbody>
            {virtual && first > 0 && <tr style={{ height: first * ROW_H }}><td colSpan={columns.length} /></tr>}
            {shown.slice(first, last).map((r, j) => (
              <Fragment key={rowKey(r)}>
                {row(r, first + j)}
                {!virtual && renderExpanded && expanded === rowKey(r) && (
                  <tr><td colSpan={columns.length} className="border-y border-accent/30 bg-raised px-4 py-2 text-fg">{renderExpanded(r)}</td></tr>
                )}
              </Fragment>
            ))}
            {virtual && last < shown.length && <tr style={{ height: (shown.length - last) * ROW_H }}><td colSpan={columns.length} /></tr>}
          </tbody>
        </table>
      </div>
      {virtual && renderExpanded && expandedRow && <div className="max-h-[45%] overflow-auto border-t border-accent/40 bg-raised px-4 py-2 text-fg">{renderExpanded(expandedRow)}</div>}
    </div>
  );
}
