import type { CheckStatus } from "@lumantite/schema";
import { STATUS_CLASS } from "../../lib/status";

export function StatusBadge({ status }: { status: CheckStatus }) {
  return <span className={`inline-block rounded border px-1 text-[10px] font-medium uppercase leading-4 ${STATUS_CLASS[status]}`}>{status}</span>;
}

export function Count({ n, status, label }: { n: number; status: CheckStatus; label?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 leading-5 ${STATUS_CLASS[status]}`} title={label ?? status}>
      <span className="font-semibold tabular-nums">{n}</span>
      <span className="text-[10px] uppercase">{label ?? status}</span>
    </span>
  );
}
