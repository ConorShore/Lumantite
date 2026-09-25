# Lumantite — Specification (draft 0.1)

Web-based tool for planning optical networks: power budgets, chromatic dispersion,
wavelength-aware routing through mux/demux and amplifiers. Networks are edited on a
schematic canvas and stored as YAML. Everything physical comes from an editable catalog.

Status: draft for review. Open questions are collected in section 14.

---

## 1. Goals

- Plan optical links end to end: transceiver Tx → patch cords → mux → fibre spans →
  splices → amplifiers → demux → transceiver Rx.
- Compute, per wavelength, at every port in the network:
  - optical power (worst / typical / best case),
  - accumulated chromatic dispersion (CD),
  - aggregate power on multi-channel fibres,
  - pass/fail against receiver, amplifier and fibre limits plus project margins.
- Be wavelength aware: CWDM (18 ch), DWDM C-band 100 GHz (40 ch) and 50 GHz (80 ch).
- Keep the YAML as the canonical, git-friendly source of truth. The canvas and the YAML
  editor are two views of the same document and edits in either are reflected in the other.
- Catalog-driven: every physical thing (transceiver, fibre type, connector, splice,
  mux, amplifier, attenuator, DCM…) is a *device class* → *catalog model* → *instance*.
- Physics-testable: the calculation engine is a pure library with hand-verifiable test cases.
- Runs from a single `docker compose up`, configured by a single application YAML file.

## 2. Non-goals (v1)

Out of scope but the schema leaves room (see 6.9 "extension fields"):

- OSNR, ASE noise accumulation, noise figure calculations (NF is *stored* in the catalog).
- PMD, nonlinear effects (SPM/XPM/FWM), reflectance / ORL, crosstalk.
- Analytical spectral hole burning in EDFAs (measured gain spectra cover it, see 7.6).
- ROADM / WSS multi-degree switching (a mux model with express ports covers simple cases).
- Geographic maps. Layout is schematic only.
- Authentication, authorisation, multi-user locking. Version control is done with git
  outside the tool.
- Live data from devices (SNMP, NETCONF).

## 3. Users and deployment

- Team use. Each user runs (or shares) one container; projects and catalog live in a
  directory mounted into the container and committed to git by the team.
- `docker compose up` starts one service: a Node server that serves the static SPA and a
  small file API. All physics runs in the browser (web worker); the server only reads and
  writes files. The same engine is available as a CLI for CI (`lumantite check
  project.yaml`).
- Single application config file `config.yaml` (section 8.1) mounted into the container.
- Target scale: hundreds of nodes, thousands of fibres, 80 channels per fibre. Full
  recompute of a 500-node / 5 000-fibre project must complete in under 2 s in the browser.

## 4. Domain model

### 4.1 Three tiers

| Tier | What it is | Where it lives |
|---|---|---|
| Device class | Generic type with a fixed parameter schema and a transfer function. Built into the engine. | code (`packages/engine`) |
| Catalog model | A make/model with concrete parameter values. May `extends` another model. | `catalog/*.yaml`, editable in UI |
| Instance | A node or fibre in a project. References a model, adds per-instance settings (channel, set gain, length…). | `project.yaml` |

Device classes in v1: `transceiver`, `fibre`, `joint` (connector or splice), `mux`
(also demux), `amplifier`, `attenuator`, `dcm`, `splitter`, `passthrough` (patch panel /
generic passive with wavelength-dependent loss), `host` (switch/router chassis, grouping only).

### 4.2 Ports

Every device model declares named ports. A port has:

- `direction`: `in`, `out` or `bidi`
- `connector`: a joint model id (e.g. `lc-upc`) — what plugs into it
- optional `channel` / `channels`: wavelength restriction (mux channel ports)

Fibres connect port to port (or fibre end to fibre end for splices). A signal enters a
device at an input port and the device class decides which output port(s) it leaves on
and with what change in power and CD.

### 4.3 Fibres

A fibre is a single core. A duplex link is two fibres. Instance fields:

- `type`: fibre catalog model (attenuation table, dispersion model, max power, defaults)
- `length_km` (default from type, e.g. patch cords)
- `a`, `b`: ends. Each has `joint` (a joint model id, default from type) and `to`
  (a port `node.port` or another fibre end `fibre.a`/`fibre.b`)
- optional overrides: `attenuation_dB_per_km`, `dispersion_ps_nm_km`, `extra_loss_dB`

### 4.4 Joints (connectors and splices)

A joint is the physical junction between two ends. Loss is counted **once per joint**, not
once per fibre end. Rules:

- fibre end → device port: the joint model is the fibre end's `joint`; its connector family
  must match the port's `connector` family (LC/UPC into an LC/UPC port). Mismatch → error.
- fibre end → fibre end: both ends must carry the same joint model (fusion ↔ fusion, or
  connector ↔ connector meaning a mated pair through an adapter). Mismatch → error.
- Joint models carry `insertion_loss_dB: {min, typ, max}` and `return_loss_dB` (stored only).

### 4.5 Signals

A signal is what the engine propagates: one wavelength from one transmitter.

```
channel      { plan, id, frequency_GHz, wavelength_nm }
power_dBm    { min, typ, max }      # worst / typical / best
cd_ps_nm     number                 # accumulated chromatic dispersion
source       tx port
path         ordered list of (element, port, power after, cd after)
```

`min` is computed with minimum Tx power, maximum losses, minimum gain; `max` with the
opposite; `typ` with typical values. Pass/fail always uses `min`/`max` (worst case);
`typ` is shown for information.

### 4.6 Wavelength plans

Built-in plans (editable YAML in the catalog):

| id | channels | definition |
|---|---|---|
| `cwdm-18` | 18 | 1271 … 1611 nm, 20 nm spacing (ITU-T G.694.2) |
| `dwdm-c-100ghz-40` | 40 | C21 … C60 = 192.1 … 196.0 THz, 100 GHz (G.694.1) |
| `dwdm-c-50ghz-80` | 80 | 192.10 … 196.05 THz, 50 GHz; ids C21, C21.5, C22 … |

Frequency in GHz is canonical for DWDM; wavelength (nm) is derived with c = 299 792 458 m/s.
CWDM channels are defined by nominal wavelength. Every wavelength-dependent parameter is
evaluated at the signal's exact wavelength, never at a "band" average.

## 5. Device classes and catalog parameters

All dB-valued losses are `{min, typ, max}` (a scalar means min = typ = max). Any parameter
may be given as a table of `{nm, value}` rows for wavelength dependence; the engine
interpolates linearly in wavelength and errors if a signal falls outside the table range.

### 5.1 `transceiver`

```yaml
kind: transceiver
id: fs-sfp-10g-dwdm-c21-80km
vendor: FS
model: SFP-10G-DWDM-C21-80
extends: generic-10g-dwdm-80km        # optional
tx:
  wavelength: { plan: dwdm-c-100ghz-40, channel: C21 }   # fixed
  # or tunable: { plan: dwdm-c-50ghz-80, channels: all }  # instance picks the channel
  power_dBm: { min: 0, typ: 2, max: 4 }
rx:
  sensitivity_dBm: -24          # at the reference BER
  overload_dBm: -7
  cd_tolerance_ps_nm: { min: -800, max: 1600 }
  wavelength_range_nm: [1260, 1620]
ports:
  tx: { direction: out, connector: lc-upc }
  rx: { direction: in,  connector: lc-upc }
# BiDi variant: one port `bidi: { direction: bidi }` with tx and rx on different wavelengths.
```

Instance settings: `channel` (tunable only), optional `tx_power_override_dBm`, `host` (a
`host` node for grouping/labelling, e.g. `A-sw1`).

### 5.2 `fibre`

```yaml
kind: fibre
id: g652d
description: ITU-T G.652.D single-mode
attenuation_dB_per_km:
  - { nm: 1310, value: 0.35 }
  - { nm: 1383, value: 0.35 }
  - { nm: 1490, value: 0.24 }
  - { nm: 1550, value: 0.20 }
  - { nm: 1625, value: 0.22 }
dispersion:
  model: g652                   # D(λ) = S0/4 · (λ − λ0⁴/λ³)
  zero_dispersion_nm: 1310
  zero_dispersion_slope_ps_nm2_km: 0.092
  # alternatives:
  # model: linear   { d0_ps_nm_km: 4.0, at_nm: 1550, slope_ps_nm2_km: 0.085 }   # NZDSF
  # model: table    [ {nm: 1530, value: 16.5}, {nm: 1565, value: 18.5} ]
max_power_dBm: 20               # aggregate launch power limit (nonlinear / safety threshold)
default_joint: fusion-splice
```

A patch-cord type adds `default_length_km: 0.002` and `default_joint: lc-upc` so a patch
instance can be written in one line.

### 5.3 `joint`

```yaml
kind: joint
id: lc-upc
family: LC                      # families must match at a port
polish: UPC
insertion_loss_dB: { min: 0.1, typ: 0.25, max: 0.5 }
return_loss_dB: 50
---
kind: joint
id: fusion-splice
family: splice
insertion_loss_dB: { min: 0.02, typ: 0.05, max: 0.1 }
```

### 5.4 `mux` (mux / demux / OADM)

A mux is direction-agnostic: signals entering channel ports combine onto `common`;
signals entering `common` are routed to the channel port whose channel matches.

```yaml
kind: mux
id: generic-dwdm-40ch-100ghz
plan: dwdm-c-100ghz-40
channel_ports: all              # or an explicit list, e.g. [C21, C22, C23, C24] for an OADM
insertion_loss_dB: { min: 2.5, typ: 3.0, max: 3.5 }    # channel port ↔ common, default
port_overrides:                 # optional per-port loss, e.g. measured values
  C40: { insertion_loss_dB: 3.8 }
express_port:                   # optional: unmatched channels pass through here
  insertion_loss_dB: { typ: 1.0, max: 1.5 }
monitor_port:                   # optional tap, informational
  tap_dB: 20
isolation_dB: 30                # stored only
passband_ghz: 50                # stored only
ports:
  common: { direction: bidi, connector: lc-upc }
  # channel ports C21…C60 are generated from `plan` / `channel_ports`
```

Rules:
- A signal arriving at a channel port with a non-matching wavelength → **error** (blocked).
- A signal arriving at `common` with no matching channel port → routed to `express` if
  present, otherwise **dropped with a warning**.
- Aggregate power at `common` (outbound) = 10·log10(Σ 10^(Pᵢ/10)) over all signals.

### 5.5 `amplifier` (EDFA)

```yaml
kind: amplifier
id: acme-edfa-ba-20
band_nm: [1528, 1566]
modes: [constant_gain, constant_output_power]
gain_dB: { min: 10, max: 23 }
input_power_total_dBm: { min: -30, max: 5 }
output_power_total_dBm: { max: 20 }
gain_flatness_dB: 1.0           # ± ripple over band, applied as worst-case spread
gain_tilt:                      # optional relative gain vs wavelength at nominal setting
  - { nm: 1528, dB: 0.5 }
  - { nm: 1566, dB: -0.5 }
noise_figure_dB: 5.5            # stored for future OSNR work
gain_model: parametric          # parametric (tilt + flatness, above) | measured (below)
gain_spectrum:                  # optional measured data, used when gain_model: measured
  - input_power_total_dBm: -20
    gain_setting_dB: 20
    spectrum: [ { nm: 1528, gain_dB: 20.6 }, { nm: 1547, gain_dB: 20.1 }, { nm: 1566, gain_dB: 19.4 } ]
  - input_power_total_dBm: -5
    gain_setting_dB: 20
    spectrum: [ { nm: 1528, gain_dB: 19.9 }, { nm: 1547, gain_dB: 20.0 }, { nm: 1566, gain_dB: 19.8 } ]
measurement_uncertainty_dB: 0.3 # ± applied to worst case when gain_model: measured
ports:
  in:  { direction: in,  connector: lc-upc }
  out: { direction: out, connector: lc-upc }
```

Instance settings: `mode`, `gain_dB` (constant gain) or `output_power_dBm` (constant output
power), optional `tilt_dB` (linear tilt applied across the band, positive = more gain at
long wavelengths), optional `gain_model` override. See 7.6 for both models.

### 5.6 `attenuator`, `dcm`, `splitter`, `passthrough`

- `attenuator`: `loss_dB` fixed, or `range_dB` for a VOA with instance `setting_dB`.
- `dcm`: `dispersion_ps_nm` (negative), `insertion_loss_dB`, both optionally per wavelength.
- `splitter`: `ratio` e.g. `[50, 50]` or `[90, 10]`; loss per leg = 10·log10(100/pct) +
  `excess_loss_dB`. Ports `in`, `out1..N`.
- `passthrough`: `insertion_loss_dB` (scalar or wavelength table), N in/out pairs. Used for
  patch panels, filters, isolators, anything passive not otherwise modelled.

### 5.7 `host`

Chassis / switch / router with named slots. Purely organisational: transceivers reference a
host so the canvas can group them and exports can label ports as `A-sw1 / Eth1/1`.

### 5.8 Extension fields

Every catalog model and instance accepts an `x:` map of arbitrary keys (validated only as
YAML). Future impairments (PMD coefficient, OSNR limits…) go here until promoted to the
schema, so files written now stay valid.

## 6. Project files

A project is one parent `project.yaml` plus any number of **fragment** files it lists under
`includes:`. Every fragment has the same top-level shape as the parent (`sites`, `nodes`,
`fibres`, `layout`) minus `project:` and `includes:`. Which file an element lives in is the
user's choice and is made visually: each file is drawn as a frame on the canvas and elements
are dragged between frames (see 9). Typical split: one file per site plus one for
interconnecting spans, but nothing enforces that.

```yaml
# project.yaml (parent)
lumantite: 1
includes:
  - { file: sites/exchange-a.yaml, label: Exchange A }
  - { file: sites/exchange-b.yaml, label: Exchange B }
  - { file: spans.yaml,            label: Inter-site spans }
project:
  name: Metro ring east
  wavelength_plans: [dwdm-c-100ghz-40]
  margins:                      # editable on the Margins page (see 7.8)
    system_margin_dB: 3.0
    ageing_dB: 1.0
    repair_splices: 2
    repair_splice_loss_dB: 0.1
    connector_ageing_dB: 0.0
    cd_margin_pct: 10
    max_channel_imbalance_dB: 6

sites:
  - { id: siteA, name: Exchange A }
  - { id: siteB, name: Exchange B }

nodes:
  - { id: A-sw1, model: generic-host, site: siteA }
  - { id: A-sfp-21, model: fs-sfp-10g-dwdm-c21-80km, site: siteA, host: A-sw1, slot: Eth1/1 }
  - { id: A-mux,  model: generic-dwdm-40ch-100ghz, site: siteA }
  - { id: A-amp,  model: acme-edfa-ba-20, site: siteA,
      settings: { mode: constant_gain, gain_dB: 20 } }
  - { id: B-demux, model: generic-dwdm-40ch-100ghz, site: siteB }
  - { id: B-sfp-21, model: fs-sfp-10g-dwdm-c21-80km, site: siteB }

fibres:
  - { id: p1, type: lc-patch, a: { to: A-sfp-21.tx }, b: { to: A-mux.C21 } }
  - { id: p2, type: lc-patch, a: { to: A-mux.common }, b: { to: A-amp.in } }
  - id: span-AB-1
    type: g652d
    length_km: 60
    a: { joint: lc-upc,        to: A-amp.out }
    b: { joint: fusion-splice, to: span-AB-2.a }
  - id: span-AB-2
    type: g652d
    length_km: 20
    a: { joint: fusion-splice, to: span-AB-1.b }
    b: { joint: lc-upc,        to: B-demux.common }
  - { id: p3, type: lc-patch, a: { to: B-demux.C21 }, b: { to: B-sfp-21.rx } }

layout:                         # canvas positions; never affects calculations
  nodes: { A-mux: { x: 120, y: 80 }, B-demux: { x: 900, y: 80 } }
  sites: { siteA: { x: 0, y: 0, w: 400, h: 300 } }
  files: { sites/exchange-a.yaml: { x: -20, y: -20, w: 440, h: 340 } }
```

The example above is shown flattened; in a split project the `A-*` nodes and `p1..p2`
patches would sit in `sites/exchange-a.yaml`, the `span-AB-*` fibres in `spans.yaml`, and
each fragment carries the `layout.nodes` entries for its own elements while the parent
carries `layout.files` and `layout.sites`.

Rules:
- ids are unique across nodes and fibres within a project, across all files.
- References (`to:`, `site:`, `host:`) may cross files freely.
- Fragments cannot include further files (one level).
- Elements declared directly in the parent belong to the parent file.
- Moving an element between files on the canvas rewrites both files on save, preserving
  comments attached to the moved element.
- A fibre end that references another fibre end must be referenced back (the engine
  validates symmetry and reports one joint).
- Unknown model ids, unknown ports, and connector family mismatches are validation errors.
- The tool must round-trip the file preserving comments, key order and formatting of
  untouched sections (use the `yaml` package Document API, never dump-from-object).

## 7. Calculation engine

Pure TypeScript library (`packages/engine`), no I/O, deterministic. Input: parsed project +
catalog. Output: a results object (7.9).

### 7.1 Units and conventions

dBm for absolute power, dB for gain/loss, km, nm, GHz, ps/nm for accumulated CD,
ps/(nm·km) for the dispersion coefficient. Linear sums use mW.

### 7.2 Fibre span

- Loss = `attenuation(λ)` × `length_km` + `extra_loss_dB`. `attenuation(λ)` is linearly
  interpolated from the type's table (or the instance override).
- CD added = `D(λ)` × `length_km`, with `D(λ)` from the type's dispersion model:
  - `g652`: D = (S₀/4)·(λ − λ₀⁴/λ³)
  - `linear`: D = D₀ + S·(λ − λ_ref)
  - `table`: interpolate
- Aggregate power check: Σ over all signals on the fibre (per direction) ≤ `max_power_dBm`.
- min/typ/max power use max/typ/min attenuation if the table gives ranges, else the scalar.

### 7.3 Joints

Each joint subtracts `insertion_loss_dB` once (max for `min` power, min for `max` power).

### 7.4 Passives

Subtract `insertion_loss_dB(λ)`; `dcm` also adds its (negative) dispersion.

### 7.5 Mux / demux

Per signal: subtract the channel-port loss (override or default). Routing per 5.4. Aggregate
power reported at the `common` port. Channel imbalance (max − min channel power, typ) is
reported at every `common` port and checked against `margins.max_channel_imbalance_dB`.

### 7.6 Amplifier

Planning-grade EDFA model (homogeneously broadened: one gain value for all channels, shaped
by a wavelength-dependent tilt and a flatness tolerance). Per amplifier:

1. `Pin_total = 10·log10(Σ 10^(Pin_i/10))` over all signals at `in` (computed separately for
   min/typ/max).
2. Check `input_power_total_dBm.min ≤ Pin_total ≤ .max` → error if outside (still computed).
3. Effective gain:
   - `constant_gain`: `G = gain_dB` setting. If `Pin_total + G > output_power_total_dBm.max`
     then `G = Pout_max − Pin_total` (saturation, **warning**).
   - `constant_output_power`: `G = output_power_dBm − Pin_total`, clamped to
     `gain_dB.{min,max}` (**warning** on clamp).
   - Either mode: `G` outside `gain_dB` range → error.
4. Per channel gain `G_i`, by `gain_model`:
   - **parametric**: `G_i = G + tilt(λ_i) + instance_tilt(λ_i)`; worst case spreads by
     ± `gain_flatness_dB`.
   - **measured**: pick the operating points whose `gain_setting_dB` is nearest to `G`
     (ties → both), interpolate their spectra linearly in `input_power_total_dBm` at the
     actual `Pin_total` (clamped to the table's range with a **warning** if outside), then
     `G_i = spectrum(λ_i) + (G − gain_setting_dB) + instance_tilt(λ_i)`; worst case spreads
     by ± `measurement_uncertainty_dB`. Because the spectrum depends on `Pin_total`, this is
     where channel-dependent gain compression shows up when the data captures it.
5. `Pout_i = Pin_i + G_i`. If `Pout_total` now exceeds `Pout_max` (spectrum gain above the
   setting) re-apply the saturation clamp uniformly.
6. Report: Pin_total, Pout_total, G, per-channel G_i, headroom to Pout_max, channel
   imbalance in and out, which model and operating points were used.

Why this is the right level for planning: in a saturated EDFA the gain is set by the *total*
input power, so an unbalanced channel set does not change the gain each channel sees, but
it does (a) let strong channels consume the output-power budget so weak channels arrive
below sensitivity, (b) push the amplifier into saturation or out of its input range, and
(c) combine with tilt/flatness so the weakest channel at the wrong end of the band is the
one that fails. All three are modelled and tested (test T18). Spectral hole burning and
per-channel gain compression are not modelled analytically; when measured gain spectra at
several input powers are available, the `measured` model captures them directly (T16b).

### 7.7 Propagation algorithm

1. Build the port graph: nodes + fibres + joints. Validate (6).
2. For every transmitter, create a signal per channel and trace it port to port. At each
   device the class's `route(signal, inPort) → [(outPort, Δpower, Δcd)]` decides where it
   goes. Tracing stops at an `rx` port (evaluate), a dead end (**warning: unterminated**),
   or when a signal re-enters a port it already passed (**error: loop**).
3. Amplifiers need *all* their inputs before they can compute gain. The first pass traces
   topology only and records which amplifiers each signal passes through, in order. Build
   the amplifier dependency graph; if it has a cycle → **error: amplified loop**. Otherwise
   evaluate amplifiers in topological order, filling in powers, then finish every signal.
4. Evaluate checks (7.8) and build results (7.9).

Complexity is linear in (signals × path length); thousands of fibres and 80 channels is
well within budget. Recompute runs in a web worker, debounced on edit.

### 7.8 Checks and margins

Project margins (Margins page) are applied as follows. Every check yields `pass`, `warn`
(within margin but tight — configurable threshold) or `fail`, with the numbers.

| Check | Rule |
|---|---|
| Rx power (low) | `P.min − system_margin − ageing − repair_splices×repair_splice_loss − connector_ageing×n_connectors ≥ rx.sensitivity_dBm` |
| Rx power (high) | `P.max ≤ rx.overload_dBm` |
| Rx wavelength | λ within `rx.wavelength_range_nm` |
| CD | `cd_tolerance.min ≤ cd × (1 + cd_margin_pct/100) ≤ cd_tolerance.max` |
| Amp input | total input within `input_power_total_dBm` (min and max cases) |
| Amp output | total output ≤ `output_power_total_dBm.max` |
| Amp gain | effective gain within `gain_dB` |
| Fibre power | aggregate launch power ≤ `fibre.max_power_dBm` |
| Channel imbalance | at any mux common / amp in-out: ≤ `max_channel_imbalance_dB` |
| Mux channel | signal wavelength matches channel port |
| Topology | unterminated tx, unconnected rx, loops, connector family mismatch, duplicate channel on one fibre in one direction |

### 7.9 Results object

```
results:
  signals[]:      { id, tx, rx?, channel, path[], power_at_rx, cd_at_rx, checks[] }
  ports[]:        { node, port, direction, channels[]: {channel, power{min,typ,max}, cd}, total_power{min,typ,max} }
  fibres[]:       { id, per direction: total_power, channels[], loss{min,typ,max}, cd_per_channel }
  amplifiers[]:   { id, pin_total, pout_total, gain_eff, mode, headroom, imbalance_in, imbalance_out }
  issues[]:       { severity: error|warn|info, code, element, message, values }
```

## 8. Configuration files

### 8.1 Application config (`config.yaml`)

```yaml
server:
  port: 8080
paths:
  projects: /data/projects       # each subdirectory or *.yaml is a project
  catalog: /data/catalog         # shared catalog; project may add a local `catalog/` too
defaults:
  wavelength_plan: dwdm-c-100ghz-40
  margins: { system_margin_dB: 3.0, ageing_dB: 1.0, repair_splices: 2, repair_splice_loss_dB: 0.1, cd_margin_pct: 10, max_channel_imbalance_dB: 6 }
ui:
  warn_threshold_dB: 1.0         # "warn" if pass margin is below this
  power_display: dBm             # dBm | mW
export:
  csv_delimiter: ","
```

### 8.2 Catalog directory

```
catalog/
  wavelength-plans.yaml
  joints.yaml
  fibres.yaml
  transceivers.yaml
  muxes.yaml
  amplifiers.yaml
  passives.yaml
```

Files are multi-document YAML (`---` separated) or a top-level list; each entry has `kind`
and `id`. A project-local `catalog/` directory overrides the shared one by id. The bundled
starter catalog includes: generic + FS / Cisco / Finisar 1G/10G/25G/100G grey, CWDM and
DWDM SFPs (fixed and tunable); G.652.D, G.655, G.657.A1, OM3/OM4 (multimode stored,
loss-only); LC/SC/E2000 UPC and APC, fusion and mechanical splices; generic CWDM 8/18 ch
and DWDM 40/80 ch muxes and 4/8 ch OADMs; generic EDFA booster, in-line and pre-amp;
fixed attenuators 1–20 dB, VOA, DCM −340/−680/−1360 ps/nm, 50/50 and 90/10 splitters.
Values come from public datasheets and are cited in a `source:` field.

### 8.3 Docker compose

```yaml
services:
  lumantite:
    image: lumantite:latest
    ports: ["8080:8080"]
    volumes:
      - ./config.yaml:/config.yaml:ro
      - ./projects:/data/projects
      - ./catalog:/data/catalog
```

## 9. User interface

Single-page app. Left: project tree (projects, catalog). Centre: tabbed workspace.
Right: inspector for the selected element. Bottom: issues list.

Tabs:

1. **Canvas** — React Flow schematic. Sites are resizable group frames; nodes render with
   their ports as handles; fibres are edges labelled with length. Colour coding: edge and
   port colour by worst check status; hover a port for per-channel power/CD; select a Tx to
   highlight its full path; filter by wavelength plan / channel. Drag from port to port
   creates a fibre (type and joints chosen in a popover). Positions are stored under
   `layout:`; layout-only edits do not trigger recompute.
   **File frames**: each project file (parent and every fragment) is drawn as a dashed,
   labelled frame, toggleable. Dragging never changes an element's file: its frame grows to
   hold it, stretching live as it is dragged. The file is changed only in the inspector or
   the YAML, and the element is then re-placed inside its new file's frame. A new element
   dropped from the palette goes into the file whose frame it lands in. "New file" on the canvas creates an
   empty fragment and adds it to `includes:`. The inspector shows and lets you change the
   file of the selected elements. Fibres belong to a file independently of their end nodes.
2. **YAML** — Monaco editor with one sub-tab per project file, schema validation, autocomplete for
   model ids and port names, and live error markers. Edits apply to the canvas on a
   debounce; canvas edits apply as minimal Document mutations so comments survive.
3. **Catalog** — table per device class; add / clone (`extends`) / edit models with a form
   generated from the class schema; shows which projects use a model.
4. **Margins** — the single page for every project-wide tolerance (7.8), with a preview of
   how many checks change status as you adjust values.
5. **Results** — per-signal link budget table (classic form: element by element, loss,
   cumulative power, CD), per-node/port table, amplifier table, issues.
6. **Exports** — CSV and Markdown (section 10).

Save writes the YAML through the server; the server rejects a save if the file changed on
disk since it was loaded (mtime/etag) and offers reload or overwrite.

## 10. Exports

- **CSV — ports**: one row per (node, port, direction, channel): power min/typ/max, CD,
  total port power, worst status. Plus one summary row per port with channel count.
- **CSV — signals**: one row per signal: tx, rx, channel, λ, Rx power min/typ/max, margin
  to sensitivity, margin to overload, CD, CD tolerance, status.
- **Markdown**: project summary, per-signal link budget tables, per-amplifier table,
  issues. Suitable for committing next to the project or pasting into a design document.
- CLI: `lumantite export project.yaml --format csv|md --out dir/` for CI.

## 11. Architecture

```
lumantite/
  packages/
    engine/      pure TS: schema types, catalog resolver, propagation, checks, exports
    schema/      zod schemas + generated JSON Schema (used by Monaco and the API)
    catalog/     bundled starter catalog YAML
  apps/
    web/         React + Vite + React Flow + Monaco; engine in a web worker
    server/      Node (Fastify): static files, /api/projects, /api/catalog, etag saves
    cli/         `lumantite check|export`
  docker/        Dockerfile (multi-stage, single image), docker-compose.yaml
  config.example.yaml
```

- Language: TypeScript end to end, pnpm workspace.
- YAML: `yaml` (eemeli) Document API for round-trip fidelity.
- Validation: zod → JSON Schema for editor tooling.
- No database. No auth.

## 12. Testing

The engine is tested with hand-derived physics cases. Each case is a small project YAML
plus expected values; expected numbers are written in the test with the arithmetic shown
so a reviewer can check them. Typical values below use the starter catalog
(G.652.D: 0.20 dB/km @1550, λ₀ = 1310 nm, S₀ = 0.092; LC/UPC typ 0.25 dB; fusion typ 0.05 dB;
mux typ 3.0 dB).

### Simple

- **T1 single span, 1550 nm.** Tx 0 dBm → 10 km → Rx, LC both ends.
  Power = 0 − 2.0 − 0.5 = −2.5 dBm. CD = 17.46 × 10 = 174.6 ps/nm
  (D(1550) = 0.023 × (1550 − 1310⁴/1550³) = 0.023 × 759.16 = 17.46).
- **T2 same at 1310 nm.** Loss 3.5 + 0.5 = 4.0 dB. CD = 0 (λ = λ₀).
- **T3 spliced sections.** 30 + 20 + 10 km with two fusion splices: loss = 12.0 + 0.1 + 0.5 = 12.6 dB;
  joints counted once each (a fibre-end pair yields one splice, not two).
- **T4 CWDM interpolation.** At 1471 nm attenuation = 0.35 − 0.11 × (88/107) = 0.2595 dB/km.
- **T5 min/typ/max bracket.** Tx {0,2,4}, LC {0.1,0.25,0.5} ×2, 10 km → Rx {−3.0, −0.5, 1.8}.
- **T6 Rx overload.** 2 m patch, Tx +4 max, overload −7 → fail high.
- **T7 CD tolerance.** 10G SFP (1600 ps/nm): 80 km → 1396.8 pass; 100 km → 1746 fail;
  100 km + DCM −800 → 946 pass. With `cd_margin_pct: 10`: 1396.8 × 1.1 = 1536.5 still pass.
- **T8 margins.** Rx sens −24, P.min −20: system 3 + ageing 1 + 2×0.1 = 4.2 → −24.2 < −24 → fail;
  set ageing 0.5 → pass.

### Mux / demux

- **T9 equal channels.** 4 × 0 dBm into mux (3.0 dB): common = −3 + 10·log10(4) = 3.02 dBm.
- **T10 unequal channels.** 0, −3, −6, −10 dBm at common: 10·log10(1 + 0.5012 + 0.2512 + 0.1)
  = 2.68 dBm; imbalance 10 dB → fails `max_channel_imbalance_dB: 6`.
- **T11 wrong wavelength on channel port** → error; **unmatched channel at common** with no
  express port → dropped + warning; with express port → routed with express loss.
- **T12 fibre launch limit.** 80 × +4 dBm after mux → 4 + 19.03 = 23.03 dBm > 20 → fail.

### Amplifier

- **T13 constant gain, unsaturated.** Pin_total −10, G 20, Pout_max 20 → Pout 10, no warning.
- **T14 constant gain, saturated.** Pin_total 2.74, G 20, Pout_max 20 → G_eff 17.26, warning.
- **T15 constant output power.** Pout set 10, Pin_total −15 → G 25, clamped to 23 → warning,
  Pout_total 8.
- **T16 tilt.** Tilt table +0.5 @1528 / −0.5 @1566, two channels at 1529.55 nm (C60) and 1560.61 nm (C21):
  per-channel gain 20 + 0.459 and 20 − 0.358 (linear interpolation).
- **T16b measured gain model.** Catalog spectra as in 5.5 at −20 and −5 dBm total input.
  Pin_total −12.5 (midpoint) and setting 20: gain at 1528 = (20.6 + 19.9)/2 = 20.25,
  at 1566 = (19.4 + 19.8)/2 = 19.6. Setting 18 → each shifted by −2. Pin_total −25 → clamped
  to the −20 row + warning.
- **T17 out-of-range input** (−35 dBm total, min −30) → error.
- **T18 the complex case — unbalanced channels → mux → EDFA → span → demux → Rx.**
  Tx typ: C21 +3, C22 0, C23 −3, C24 −6 dBm. Mux 3.0 dB → 0, −3, −6, −9; total 2.74 dBm.
  EDFA constant gain 20, Pout_max 20 → saturates, G_eff 17.26 → 17.26, 14.26, 11.26, 8.26 dBm
  (Pout_total 20.0). 80 km G.652.D + 2 × LC = 16.5 dB → 0.76, −2.24, −5.24, −8.24.
  Demux 3.0 → −2.24, −5.24, −8.24, −11.24 dBm. (The span uses a flat 0.20 dB/km override; with the
  G.652.D table interpolated at 1558–1561 nm the span is 16.7 dB and every Rx value is 0.2 dB lower,
  same pass/fail.) Rx sens −14, system margin 3 → C24 fails
  (−11.24 < −11), the rest pass. With `gain_flatness_dB: 1` worst case C24.min = −12.24.
  Same network with the EDFA in constant-output-power mode set to 20 dBm gives identical
  numbers; set to 17 dBm → G 14.26 → Rx −5.24, −8.24, −11.24, −14.24 so C23 and C24 fail.
  Imbalance in = out = 9 dB.
- **T19 cascaded amplifiers** (two spans, two EDFAs): topological ordering; second amp's
  Pin_total derives from first amp's output.
- **T20 amplified loop** (ring with an amp and no drop) → error, no infinite loop.

### Topology and format

- **T21 BiDi transceiver pair** on one fibre: two signals, opposite directions, different λ,
  each evaluated independently; fibre aggregate power reported per direction.
- **T22 connector family mismatch** (SC end into LC port) → error.
- **T23 unterminated Tx** → warning; **Rx with no signal** → warning.
- **T24 YAML round-trip**: load → move a node → change a length → save; comments, key
  order and untouched sections byte-identical, across parent and fragment files.
- **T24b move between files**: drag a node from `sites/a.yaml` into `spans.yaml`; the node
  and its comment leave one file and appear in the other, nothing else changes; ids stay
  unique and cross-file `to:` references still resolve.
- **T25 performance**: generated 500-node / 5 000-fibre / 40-channel project computes in
  < 2 s (vitest benchmark) and the canvas stays interactive.

UI: Playwright smoke tests (open project, drag a fibre, see status change, export CSV).

## 13. Milestones

1. **Engine + CLI**: schema, catalog resolver, propagation, checks, exports, tests T1–T25.
2. **Server + YAML tab**: load/save projects and catalog, Monaco with schema, results table.
3. **Canvas**: React Flow view, two-way sync, path highlighting, wavelength filter.
4. **Catalog editor + Margins page + Exports tab.**
5. **Docker image, compose file, starter catalog with cited datasheets, docs.**

## 14. Decisions log

Resolved in review (2026-09-25):

1. Amplifiers support both the parametric (tilt + flatness) and the measured
   gain-spectrum model; choice per catalog model, overridable per instance.
2. Projects are a parent YAML plus fragment files chosen visually on the canvas.
3. Shared container, no auth, save protected by change-on-disk detection only.
4. CWDM = 18 channels; DWDM 40 ch = C21–C60 (192.1–196.0 THz); 80 ch = 50 GHz grid.
5. Fibre launch limit is a per-fibre-type `max_power_dBm`, default +20 dBm.
6. ROADM / WSS out of v1.
7. Repair margin = N future splices × splice loss (dB/km form can be added later).
8. Starter catalog seeds FS, Cisco, Finisar transceivers and generic mux / EDFA models.
