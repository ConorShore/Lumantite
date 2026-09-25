import { useMemo } from "react";
import type { Severity } from "@lumantite/schema";
import { useAllIssues } from "../../store/hooks";
import { useUi } from "../../store/uiStore";
import { selectIssue } from "../../store/actions";
import { SEVERITY_CLASS } from "../../lib/status";

const SEVS: Severity[] = ["error", "warn", "info"];

export function IssuesPanel() {
  const issues = useAllIssues();
  const filter = useUi((s) => s.severity);
  const toggle = useUi((s) => s.toggleSeverity);
  const counts = useMemo(() => {
    const c: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
    for (const i of issues) c[i.severity]++;
    return c;
  }, [issues]);
  const shown = useMemo(() => issues.filter((i) => filter[i.severity]).slice(0, 1000), [issues, filter]);

  return (
    <section className="h-40 shrink-0 flex flex-col border-t border-line bg-surface" aria-label="Issues">
      <div className="flex items-center gap-3 px-2 h-7 border-b border-line bg-surface">
        <span className="font-medium text-fg">Issues</span>
        {SEVS.map((s) => (
          <label key={s} className={`flex items-center gap-1 cursor-pointer ${SEVERITY_CLASS[s]}`}>
            <input type="checkbox" checked={filter[s]} onChange={() => toggle(s)} />
            {s} ({counts[s]})
          </label>
        ))}
      </div>
      <ul className="flex-1 overflow-auto font-mono text-[11px]">
        {shown.map((i, n) => (
          <li key={n}>
            <button
              className="w-full text-left px-2 py-0.5 hover:bg-raised flex gap-2 text-fg"
              onClick={() => selectIssue(i)}
              title="Select element"
            >
              <span className={`w-10 shrink-0 uppercase ${SEVERITY_CLASS[i.severity]} ${i.severity === "error" ? "font-bold" : ""}`}>{i.severity}</span>
              <span className="w-44 shrink-0 truncate text-muted">{i.code}</span>
              <span className="w-40 shrink-0 truncate text-fg/85">{i.element ?? ""}</span>
              <span className="truncate text-fg">{i.message}</span>
            </button>
          </li>
        ))}
        {!shown.length && <li className="px-2 py-1 text-muted">No issues.</li>}
      </ul>
    </section>
  );
}
