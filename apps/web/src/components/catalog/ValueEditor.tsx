/**
 * Generic nested editor for catalog entries. Special cases: Range3 {min,typ,max} as three inputs
 * (with scalar ↔ range toggle), wavelength tables ([{nm, ...}]) as a grid.
 */
import { useEffect, useState } from "react";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };
const isObj = (v: Json | undefined): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const R3 = ["min", "typ", "max"];
export const isRange3 = (v: Json | undefined): v is Obj =>
  isObj(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => R3.includes(k)) && Object.values(v).every((x) => typeof x === "number");
export const isWlTable = (v: Json | undefined): v is Obj[] =>
  Array.isArray(v) && v.length > 0 && v.every((r) => isObj(r) && typeof r.nm === "number");

const inp = "field py-px";

function NumInput({ value, onChange, placeholder, className = "w-20" }: { value: number | undefined; onChange(v: number | undefined): void; placeholder?: string; className?: string }) {
  const [t, setT] = useState(value === undefined ? "" : String(value));
  useEffect(() => setT(value === undefined ? "" : String(value)), [value]);
  return (
    <input
      className={`${inp} ${className} tabular-nums`}
      type="number" step="any" placeholder={placeholder} value={t}
      onChange={(e) => { setT(e.target.value); const n = e.target.value === "" ? undefined : Number(e.target.value); if (n === undefined || Number.isFinite(n)) onChange(n); }}
    />
  );
}

function Range3Editor({ value, onChange }: { value: Obj; onChange(v: Json): void }) {
  const set = (k: string, n: number | undefined) => { const next = { ...value }; if (n === undefined) delete next[k]; else next[k] = n; onChange(next); };
  return (
    <span className="inline-flex items-center gap-1">
      {R3.map((k) => <NumInput key={k} className="w-16" placeholder={k} value={value[k] as number | undefined} onChange={(n) => set(k, n)} />)}
      <button className="text-muted hover:text-accent" title="Make scalar" onClick={() => onChange((value.typ ?? value.max ?? value.min ?? 0) as number)}>=</button>
    </span>
  );
}

function WlTableEditor({ value, onChange }: { value: Obj[]; onChange(v: Json): void }) {
  const cols = [...new Set(value.flatMap((r) => Object.keys(r)))].filter((c) => c !== "nm");
  const setRow = (i: number, row: Obj) => onChange(value.map((r, j) => (j === i ? row : r)));
  return (
    <table className="text-[11px]">
      <thead><tr className="text-muted"><th className="text-left">nm</th>{cols.map((c) => <th key={c} className="text-left pl-2">{c}</th>)}<th /></tr></thead>
      <tbody>
        {value.map((r, i) => (
          <tr key={i}>
            <td><NumInput className="w-16" value={r.nm as number} onChange={(n) => setRow(i, { ...r, nm: n ?? 0 })} /></td>
            {cols.map((c) => <td key={c} className="pl-2"><ValueEditor value={r[c]} onChange={(v) => setRow(i, { ...r, [c]: v })} /></td>)}
            <td><button className="px-1 text-fail/80 hover:text-fail" title="Remove row" onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button></td>
          </tr>
        ))}
      </tbody>
      <tfoot><tr><td colSpan={cols.length + 2}><button className="text-aqua hover:text-aqua-hover" onClick={() => onChange([...value, structuredClone(value[value.length - 1]!)])}>+ row</button></td></tr></tfoot>
    </table>
  );
}

export function ValueEditor({ value, onChange }: { value: Json | undefined; onChange(v: Json): void }) {
  if (typeof value === "number")
    return (
      <span className="inline-flex items-center gap-1">
        <NumInput value={value} onChange={(n) => onChange(n ?? 0)} />
        <button className="text-muted hover:text-accent" title="Make min/typ/max range" onClick={() => onChange({ min: value, typ: value, max: value })}>±</button>
      </span>
    );
  if (typeof value === "boolean") return <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />;
  if (typeof value === "string" || value === null || value === undefined)
    return <input className={`${inp} w-full min-w-32`} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  if (isRange3(value)) return <Range3Editor value={value} onChange={onChange} />;
  if (isWlTable(value)) return <WlTableEditor value={value} onChange={onChange} />;
  if (Array.isArray(value))
    return (
      <div className="space-y-0.5">
        {value.map((v, i) => (
          <div key={i} className="flex items-start gap-1">
            <span className="text-muted w-4 text-right">{i}</span>
            <ValueEditor value={v} onChange={(nv) => onChange(value.map((x, j) => (j === i ? nv : x)))} />
            <button className="text-fail/80 hover:text-fail" onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button className="text-aqua hover:text-aqua-hover" onClick={() => onChange([...value, value.length ? structuredClone(value[value.length - 1]!) : ""])}>+ item</button>
      </div>
    );
  return <ObjectEditor value={value} onChange={onChange} />;
}

export function ObjectEditor({ value, onChange, hide = [], suggestions = [] }: { value: Obj; onChange(v: Obj): void; hide?: string[]; suggestions?: { key: string; make(): Json }[] }) {
  const [newKey, setNewKey] = useState("");
  const keys = Object.keys(value).filter((k) => !hide.includes(k));
  const missing = suggestions.filter((s) => !(s.key in value) && !hide.includes(s.key));
  const add = (k: string, v: Json) => { if (k && !(k in value)) onChange({ ...value, [k]: v }); };
  return (
    <div className="border-l border-line pl-2 space-y-0.5">
      {keys.map((k) => (
        <div key={k} className="flex items-start gap-1">
          <span className="w-28 shrink-0 truncate pt-0.5 font-mono text-[11px] text-muted" title={k}>{k}</span>
          <div className="flex-1 min-w-52"><ValueEditor value={value[k]} onChange={(v) => onChange({ ...value, [k]: v })} /></div>
          <button className="text-fail/80 hover:text-fail px-1" title={`Remove ${k}`} onClick={() => { const n = { ...value }; delete n[k]; onChange(n); }}>×</button>
        </div>
      ))}
      <div className="flex items-center gap-1 pt-0.5">
        {missing.length > 0 && (
          <select className={`${inp} text-[11px] text-aqua`} value="" onChange={(e) => { const s = missing.find((m) => m.key === e.target.value); if (s) add(s.key, s.make()); }}>
            <option value="">+ field…</option>
            {missing.map((m) => <option key={m.key}>{m.key}</option>)}
          </select>
        )}
        <input className={`${inp} w-28 text-[11px]`} placeholder="custom key" value={newKey} onChange={(e) => setNewKey(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { add(newKey.trim(), ""); setNewKey(""); } }} />
      </div>
    </div>
  );
}
