import { useMemo } from "react";
import type { NodeSettings, DeviceModel, NodeInst } from "@lumantite/schema";
import { portsOf } from "../../adapters/engine";
import { useProject } from "../../store/projectStore";
import { useCatalog } from "../../store/catalogStore";
import { useResults } from "../../store/resultsStore";
import { useUi } from "../../store/uiStore";
import { portIndex } from "../../store/selectors";
import { dB } from "../../lib/format";
import { StatusBadge } from "../common/StatusBadge";
import { Row, Section, TextField, NumberField, SelectField } from "./fields";
import { ElementIssues } from "./Inspector";

export function NodeInspector({ id }: { id: string }) {
  const model = useProject((s) => s.model)!;
  const apply = useProject((s) => s.applyOps);
  const catalog = useCatalog((s) => s.catalog);
  const results = useResults((s) => s.results);
  const select = useUi((s) => s.select);
  const setCatalogView = useUi((s) => s.setCatalogView);
  const setTab = useUi((s) => s.setTab);
  const inst = model.nodes.find((n) => n.id === id);
  const dm = inst ? catalog.models.get(inst.model) : undefined;
  const sameKind = useMemo(() => [...catalog.models.values()].filter((m) => !dm || m.kind === dm.kind).map((m) => m.id).sort(), [catalog, dm]);
  if (!inst) return <Section title="Node">Not found: {id}</Section>;

  const patch = (p: Partial<NodeInst>) => apply([{ op: "updateNode", id, patch: p }]);
  const setSetting = (key: keyof NodeSettings, v: unknown) => {
    const next: Record<string, unknown> = { ...(inst.settings ?? {}), [key]: v };
    if (v === undefined) delete next[key];
    patch({ settings: Object.keys(next).length ? (next as NodeSettings) : undefined });
  };
  const hosts = model.nodes.filter((n) => catalog.models.get(n.model)?.kind === "host" && n.id !== id).map((n) => n.id);
  const status = results?.elementStatus[id] ?? "n/a";
  const ports = dm ? portsOf(dm, catalog) : {};
  const pidx = portIndex(results);
  const fibreAt = (port: string) => model.fibres.find((f) => f.a.to === `${id}.${port}` || f.b.to === `${id}.${port}`);
  const signals = results?.signals.filter((s) => s.tx.node === id || s.rx?.node === id) ?? [];

  return (
    <>
      <Section title={dm?.kind ?? "node"} right={<StatusBadge status={status} />}>
        <Row label="id"><TextField mono value={inst.id} onCommit={(v) => { if (v && !apply([{ op: "renameId", kind: "node", from: id, to: v }]).some((i) => i.severity === "error")) select([{ kind: "node", id: v }]); }} /></Row>
        <Row label="model">
          <div className="flex gap-1">
            <SelectField value={inst.model} options={sameKind} onChange={(v) => v && patch({ model: v })} />
            <button className="link" title="Open in catalog" onClick={() => { setCatalogView(dm?.kind ?? "transceiver", inst.model); setTab("catalog"); }}>↗</button>
          </div>
        </Row>
        <Row label="name"><TextField value={inst.name} onCommit={(v) => patch({ name: v })} /></Row>
        <Row label="site"><SelectField value={inst.site} allowEmpty="—" options={model.sites.map((s) => s.id)} onChange={(v) => patch({ site: v })} /></Row>
        {dm?.kind === "transceiver" && (
          <>
            <Row label="host"><SelectField value={inst.host} allowEmpty="—" options={hosts} onChange={(v) => patch({ host: v })} /></Row>
            <Row label="slot"><TextField value={inst.slot} onCommit={(v) => patch({ slot: v })} /></Row>
          </>
        )}
        <Row label="file">
          <SelectField value={inst.file} options={model.files.map((f) => ({ value: f.path, label: f.label ?? f.path }))} onChange={(v) => v && apply([{ op: "moveToFile", kind: "node", id, file: v }])} />
        </Row>
      </Section>
      {dm && <Settings dm={dm} settings={inst.settings ?? {}} set={setSetting} />}
      {Object.keys(ports).length > 0 && (
        <Section title="Ports">
          <table className="w-full text-[11px]">
            <thead><tr className="text-left text-muted"><th>port</th><th>dir</th><th>fibre</th><th className="text-right">in/out typ</th><th /></tr></thead>
            <tbody>
              {Object.entries(ports).filter(([p]) => !ports[p]!.channel || fibreAt(p) || pidx?.get(`${id}.${p}`)).map(([p, spec]) => {
                const pr = pidx?.get(`${id}.${p}`);
                const f = fibreAt(p);
                return (
                  <tr key={p} className="border-t border-line-soft">
                    <td className="font-mono">{p}</td>
                    <td>{spec.direction}</td>
                    <td>{f ? <button className="link font-mono" onClick={() => select([{ kind: "fibre", id: f.id }])}>{f.id}</button> : <span className="text-faint">—</span>}</td>
                    <td className="text-right tabular-nums">{dB(pr?.in.totalPower?.typ)} / {dB(pr?.out.totalPower?.typ)}</td>
                    <td className="pl-1">{pr && <StatusBadge status={pr.status} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {dm?.kind === "mux" && <div className="text-[10px] text-muted">Unused channel ports hidden.</div>}
        </Section>
      )}
      {signals.length > 0 && (
        <Section title={`Signals (${signals.length})`}>
          <ul className="space-y-0.5 text-[11px]">
            {signals.map((s) => (
              <li key={s.id} className="flex items-center gap-1">
                <StatusBadge status={s.status} />
                <span className="font-mono truncate" title={s.id}>{s.tx.node === id ? `→ ${s.rx?.node ?? "(none)"}` : `← ${s.tx.node}`}</span>
                <span className="ml-auto tabular-nums">{s.channel.id} {dB(s.powerAtEnd.typ)} dBm</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <ElementIssues id={id} />
    </>
  );
}

function Settings({ dm, settings, set }: { dm: DeviceModel; settings: NodeSettings; set(k: keyof NodeSettings, v: unknown): void }) {
  const catalog = useCatalog((s) => s.catalog);
  if (dm.kind === "transceiver") {
    const wl = dm.tx.wavelength;
    const tunable = "channels" in wl;
    const chans = tunable ? (wl.channels === "all" ? catalog.channels(wl.plan).map((c) => c.id) : wl.channels) : [];
    return (
      <Section title="Settings">
        {tunable && <Row label="channel"><SelectField value={settings.channel} allowEmpty="(first)" options={chans} onChange={(v) => set("channel", v)} /></Row>}
        <Row label="Tx override" title="tx_power_override_dBm"><NumberField value={settings.tx_power_override_dBm} placeholder="dBm" onCommit={(v) => set("tx_power_override_dBm", v)} /></Row>
        <Row label="ports" title="port_side: canvas only"><SelectField value={settings.port_side} allowEmpty="default (right)" options={[{ value: "right", label: "right" }, { value: "left", label: "left" }, { value: "split", label: "split (rx left, tx right)" }]} onChange={(v) => set("port_side", v)} /></Row>
      </Section>
    );
  }
  if (dm.kind === "amplifier") {
    return (
      <Section title="Settings">
        <Row label="mode"><SelectField value={settings.mode} allowEmpty="—" options={dm.modes} onChange={(v) => set("mode", v)} /></Row>
        <Row label="gain dB"><NumberField value={settings.gain_dB} placeholder={`${dm.gain_dB.min}…${dm.gain_dB.max}`} onCommit={(v) => set("gain_dB", v)} /></Row>
        <Row label="Pout dBm"><NumberField value={settings.output_power_dBm} placeholder={`≤ ${dm.output_power_total_dBm.max}`} onCommit={(v) => set("output_power_dBm", v)} /></Row>
        <Row label="tilt dB"><NumberField value={settings.tilt_dB} onCommit={(v) => set("tilt_dB", v)} /></Row>
        <Row label="gain model"><SelectField value={settings.gain_model} allowEmpty={`(model: ${dm.gain_model ?? "parametric"})`} options={["parametric", "measured"]} onChange={(v) => set("gain_model", v)} /></Row>
      </Section>
    );
  }
  if (dm.kind === "attenuator" && dm.range_dB) {
    return (
      <Section title="Settings">
        <Row label="setting dB"><NumberField value={settings.setting_dB} placeholder={`${dm.range_dB.min}…${dm.range_dB.max}`} onCommit={(v) => set("setting_dB", v)} /></Row>
      </Section>
    );
  }
  return null;
}
