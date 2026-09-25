import { useEffect, useState, type ReactNode } from "react";

export function Row({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <label className="grid grid-cols-[88px_1fr] items-center gap-1 py-0.5" title={title}>
      <span className="text-muted truncate">{label}</span>
      <span className="min-w-0">{children}</span>
    </label>
  );
}

const input = "field w-full py-px";

/** Text input that commits on blur / Enter (not per keystroke), so each edit is one op. */
export function TextField({ value, onCommit, placeholder, list, mono }: { value: string | undefined; onCommit(v: string | undefined): void; placeholder?: string; list?: string; mono?: boolean }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  const commit = () => { const t = v.trim(); if (t !== (value ?? "")) onCommit(t === "" ? undefined : t); };
  return (
    <input
      className={`${input} ${mono ? "font-mono" : ""}`}
      value={v}
      placeholder={placeholder}
      list={list}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setV(value ?? ""); }}
    />
  );
}

export function NumberField({ value, onCommit, placeholder, step = "any" }: { value: number | undefined; onCommit(v: number | undefined): void; placeholder?: string; step?: string }) {
  const [v, setV] = useState(value === undefined ? "" : String(value));
  useEffect(() => setV(value === undefined ? "" : String(value)), [value]);
  const commit = () => {
    const t = v.trim();
    const n = t === "" ? undefined : Number(t);
    if (n !== undefined && !Number.isFinite(n)) { setV(value === undefined ? "" : String(value)); return; }
    if (n !== value) onCommit(n);
  };
  return (
    <input
      className={`${input} tabular-nums`}
      type="number"
      step={step}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}

export function SelectField({ value, options, onChange, allowEmpty }: { value: string | undefined; options: (string | { value: string; label: string })[]; onChange(v: string | undefined): void; allowEmpty?: string }) {
  const opts = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const known = value === undefined || opts.some((o) => o.value === value);
  return (
    <select className={input} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}>
      {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
      {!known && <option value={value}>{value} (unknown)</option>}
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-line px-2 py-1.5">
      <h4 className="mb-1 flex items-center text-[10px] font-semibold uppercase tracking-wider text-muted">{title}<span className="ml-auto normal-case tracking-normal">{right}</span></h4>
      {children}
    </section>
  );
}
