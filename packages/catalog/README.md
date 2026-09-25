# @lumantite/catalog

Starter catalog (wavelength plans, connectors, fibre, transceiver, mux, amplifier and passive
models) plus example projects for Lumantite. Data only — see `docs/CONTRACT.md` for the
package's runtime surface (`catalogDir`, `examplesDir`).

```
catalog/                bundled starter catalog, SPEC.md §8.2
  wavelength-plans.yaml  GENERATED — see scripts/gen-plans.ts
  joints.yaml
  fibres.yaml
  transceivers.yaml
  transceivers-fs.yaml   GENERATED — see scripts/gen-fs-transceivers.ts
  muxes.yaml
  amplifiers.yaml
  passives.yaml
scripts/gen-plans.ts     regenerates wavelength-plans.yaml (npx tsx scripts/gen-plans.ts)
scripts/gen-fs-transceivers.ts  regenerates transceivers-fs.yaml from data/fs/*.yaml
data/fs/                 FS.com datasheet rows (generator input, not loaded as catalog)
examples/                example projects (SPEC.md §6)
  simple-link/
  dwdm-amplified/
  cwdm-ring/
test/catalog.test.ts     loads every catalog file + example, resolves `extends`, validates
                          against @lumantite/schema
```

Every catalog file is a top-level YAML sequence of entries (`kind` + `id` + fields), which is
one of the two forms `@lumantite/project`'s `CatalogSession` accepts (SPEC.md §8.2 /
`docs/CONTRACT.md`). `extends` deep-merges the referenced model (child fields win) before
schema validation — see the test for the resolution algorithm.

## Wavelength plans (`wavelength-plans.yaml`, generated)

| id | channels | source |
|---|---|---|
| `cwdm-18` | 18, 1271-1611nm, 20nm steps | ITU-T G.694.2 |
| `dwdm-c-100ghz-40` | 40, C21-C60, 192100-196000 GHz, 100GHz steps | ITU-T G.694.1 |
| `dwdm-c-100ghz-45` | 45, C17-C61, 191700-196100 GHz, 100GHz steps (FS fixed DWDM grid) | ITU-T G.694.1 |
| `dwdm-c-50ghz-80` | 80, C21-C60.5, 192100-196050 GHz, 50GHz steps | ITU-T G.694.1 |

`wavelength_nm` is derived from `frequency_GHz` with `299792458 / frequency_GHz`, rounded to 3
decimals. Regenerate with `npx tsx packages/catalog/scripts/gen-plans.ts`; do not hand-edit.

## Joints (`joints.yaml`)

| id | family | polish | IL min/typ/max (dB) | source |
|---|---|---|---|---|
| `lc-upc` | LC | UPC | 0.1 / 0.2 / 0.5 | Telcordia GR-326-CORE generic values |
| `lc-apc` | LC | APC | 0.1 / 0.2 / 0.5 | Telcordia GR-326-CORE generic values |
| `sc-upc` | SC | UPC | 0.1 / 0.25 / 0.5 | Telcordia GR-326-CORE generic values |
| `sc-apc` | SC | APC | 0.1 / 0.25 / 0.5 | Telcordia GR-326-CORE generic values |
| `e2000-apc` | E2000 | APC | 0.1 / 0.2 / 0.3 | typical value (unverified) |
| `mpo-12` | MPO | UPC | 0.15 / 0.35 / 0.75 | Telcordia GR-1435-CORE generic values |
| `fusion-splice` | splice | — | 0.02 / 0.05 / 0.1 | Corning splicing guidelines (typical) |
| `mechanical-splice` | splice | — | 0.1 / 0.15 / 0.3 | typical value (unverified) |

## Fibres (`fibres.yaml`)

| id | standard | attenuation @1550 (dB/km) | dispersion | source |
|---|---|---|---|---|
| `g652d` | ITU-T G.652.D | 0.20 | g652, λ0=1310, S0=0.092 | ITU-T G.652 + common datasheet (exact table given in brief) |
| `g652d-low-loss` | ITU-T G.652.D | 0.17 | g652, λ0=1310, S0=0.092 | 0.17@1550 per low-loss datasheets; other bands typical (unverified) |
| `g655` | ITU-T G.655 (NZDSF) | 0.21 | linear, D0=4.0@1550, slope 0.085 | ITU-T G.655 dispersion limits; attenuation typical (unverified) |
| `g657a1` | ITU-T G.657.A1 | 0.20 | g652, λ0=1310, S0=0.092 | ITU-T G.657.A1 (G.652.D-compatible) |
| `om4` | OM4 (multimode) | 3.0@850 / 1.0@1300 | none (loss-only) | ISO/IEC 11801 / TIA-492AAAD OM4 limits |
| `om3` / `om2` / `om1` | OM3 / OM2 / OM1 (multimode) | 3.5@850 / 1.5@1300 | none (loss-only) | ISO/IEC 11801 cabled multimode limits |
| `lc-patch` | extends `g657a1` | — | — | generic patch cord, LC/UPC, 2m |
| `lc-apc-patch` | extends `g657a1` | — | — | generic patch cord, LC/APC, 2m |
| `sc-patch` | extends `g657a1` | — | — | generic patch cord, SC/UPC, 2m |

## Transceivers (`transceivers.yaml`)

Generic (grey / MSA-typical) base models:

| id | λ / plan | reach | source |
|---|---|---|---|
| `generic-1g-lx` | 1310nm | 10km | IEEE 802.3-2018 cl.38 (1000BASE-LX) |
| `generic-10g-lr` | 1310nm | 10km | IEEE 802.3-2018 cl.52 (10GBASE-LR) |
| `generic-10g-er` | 1550nm | 40km | IEEE 802.3-2018 cl.52 (10GBASE-ER) |
| `generic-10g-zr` | 1550nm | 80km | typical value (unverified) — informal ZR MSA |
| `generic-10g-cwdm-80km` | `cwdm-18`, tunable | 80km | typical value (unverified) — CWDM "EZX" class |
| `generic-10g-dwdm-80km` | `dwdm-c-100ghz-40`, tunable | 80km | SPEC.md §5.1 worked example |
| `generic-10g-dwdm-tunable` | `dwdm-c-50ghz-80`, tunable | 80km | Cisco DWDM-SFP10G-C class values |
| `example-10g-dwdm-t18` | `dwdm-c-100ghz-40`, tunable | 80km | SPEC.md test T18 (§12) — see "Examples" below and the model's own `description` |
| `generic-25g-lr` | 1310nm | 10km | IEEE 802.3by-2016 cl.114 (25GBASE-LR) |
| `generic-100g-lr4` | 1300nm nominal (4-lane, see below) | 10km | IEEE 802.3ba-2010 cl.88 (100GBASE-LR4) |
| `generic-1g-bidi` | Tx1310/Rx1490, bidi port | 10km | IEEE 802.3-2018 cl.59 (1000BASE-BX10-D) |
| `generic-1g-bidi-u` | Tx1490/Rx1310, bidi port | 10km | IEEE 802.3-2018 cl.59 (1000BASE-BX10-U) — mate of `generic-1g-bidi`, added beyond the brief because a BiDi link needs both ends (see "Schema / brief notes" below) |

Vendor models (`extends` a generic base):

| id | vendor | extends | source |
|---|---|---|---|
| `fs-sfp-10g-lr` | FS | `generic-10g-lr` | fs.com datasheet PDF (Tx power + Rx sensitivity(OMA) verified; overload typical) |
| `fs-sfp-10g-er` | FS | `generic-10g-er` | typical value (unverified) |
| `fs-sfp-10g-zr` | FS | `generic-10g-zr` | fs.com datasheet PDF (product confirmed; values typical — PDF was image-only) |
| `fs-sfp-10g-dwdm-80km` | FS | `generic-10g-dwdm-tunable` | fs.com product page (Cisco DWDM-SFP10G-C compatible; power/CD tolerance per Cisco datasheet) |
| `fs-sfp-10g-dwdm-c21-80km` | FS | `generic-10g-dwdm-80km` | SPEC.md §5.1 worked example, verbatim |
| `fs-sfp-10g-dwdm-c22-80km` | FS | `generic-10g-dwdm-80km` | typical value (unverified), same class as C21 fixed to C22 |
| `cisco-sfp-10g-lr` | Cisco | `generic-10g-lr` | cisco.com datasheet (product/URL confirmed; IEEE-typical values) |
| `cisco-sfp-10g-er` | Cisco | `generic-10g-er` | cisco.com datasheet (product/URL confirmed; IEEE-typical values) |
| `cisco-dwdm-sfp10g-c` | Cisco | `generic-10g-dwdm-tunable` | cisco.com datasheet (launch power -1..+4dBm and CD tolerance 1600ps/nm confirmed; rest typical) |
| `finisar-ftlx1471d3bcl` | Finisar/Coherent | `generic-10g-lr` | Mouser-hosted datasheet PDF — confirms this is 10GBASE-LR 1310nm, **not** 1471nm CWDM |
| `finisar-ftlx1671d3bcl` | Finisar/Coherent | `generic-10g-er` | Mouser-hosted datasheet PDF — confirms 10GBASE-ER 1550nm/40km, Tx -3..+3dBm, Rx -14.1..-1.0dBm, **not** 1671nm CWDM |

## FS.com SFP / SFP+ (`transceivers-fs.yaml`, generated)

FS.com 100M, 1G and 10G SFP/SFP+ optics — grey, BiDi, CWDM, fixed DWDM and tunable DWDM —
generated from hand-transcribed FS datasheet rows in `data/fs/*.yaml` (format, sources and
conventions in `data/fs/README.md`). Regenerate with
`npx tsx packages/catalog/scripts/gen-fs-transceivers.ts`; do not hand-edit.

- Ids are `fs-<FS part number>` (e.g. `fs-sfp-10glr-31`). Fixed-channel WDM families produce a
  family model (channel chosen per instance) plus one fixed model per channel
  (`fs-cwdm-sfp10g-40l-1471`, `fs-dw-sfp10g80-xx-c21`). (FS's tunable DWDM SFP+ parts are currently all excluded — see below.)
- Physical/optical characteristics only; brand compatibility coding is out of scope. RJ-45
  copper, DAC/AOC and CSFP parts are excluded.
- Accuracy over coverage: every value is read from an FS datasheet, and any part whose FS
  sources disagree, whose datasheet is garbled/ambiguous, or which has values copied from a
  sibling part is left out — see `data/fs/README.md` "Exclusions" and `data/fs/excluded/`.
- The six hand-written `fs-sfp-10g-*` models in `transceivers.yaml` predate this and are kept
  unchanged because tests, examples and the README reference their ids.

## Muxes / demux / OADM (`muxes.yaml`)

| id | plan | channels | IL min/typ/max (dB) | source |
|---|---|---|---|---|
| `generic-cwdm-8ch` | `cwdm-18` | 1471-1611 (8) | 1.5/2.0/3.0 | typical value (unverified) |
| `generic-cwdm-18ch` | `cwdm-18` | all (18) | 2.5/3.5/4.5 | typical value (unverified) |
| `generic-dwdm-40ch-100ghz` | `dwdm-c-100ghz-40` | all (40) | 2.5/3.0/3.5 | brief / SPEC.md worked example |
| `generic-dwdm-80ch-50ghz` | `dwdm-c-50ghz-80` | all (80) | 4.0/4.5/5.5 | brief; typical (unverified) |
| `generic-dwdm-oadm-4ch` | `dwdm-c-100ghz-40` | C21-C24 | 1.0/1.5/2.5 (express typ 1.0 / max 1.5) | brief; typical (unverified) |
| `generic-dwdm-oadm-8ch` | `dwdm-c-100ghz-40` | C21-C28 | 1.2/1.8/2.8 (express typ 1.3 / max 2.0) | typical value (unverified) |
| `generic-cwdm-oadm-1471` / `-1491` / `-1511` / `-1531` | `cwdm-18` | 1 channel each | 1.0/1.5/2.5 (express typ 1.0 / max 1.5) | typical value (unverified) — single-channel CWDM add/drop modules used by the cwdm-ring example; see "Examples" and "Schema / brief notes" below for why each is single-channel rather than one shared 8ch OADM |

## Amplifiers (`amplifiers.yaml`)

| id | gain (dB) | Pin range (dBm) | Pout max (dBm) | model | source |
|---|---|---|---|---|---|
| `generic-edfa-booster` | 10-23 | -30..5 | 20 | parametric | SPEC.md §5.5 worked example |
| `generic-edfa-inline` | 15-30 | -35..-5 | 17 | parametric | typical value (unverified) |
| `generic-edfa-preamp` | 20-35 | -40..-15 | 10 | parametric | typical value (unverified) |
| `example-edfa-measured` | extends booster | — | 20 | measured | SPEC.md §5.5 `gain_spectrum` rows, verbatim |

## Passives (`passives.yaml`)

Fixed attenuators `att-1db` … `att-20db` (1/2/3/5/10/15/20 dB) and `voa-0-20db` (0-20dB VOA) —
generic, nominal ratings. DCMs `dcm-20km` (-340ps/nm, IL 2.5 typ), `dcm-40km` (-680, IL 3.0
typ), `dcm-80km` (-1360, IL 4.0 typ) — dispersion values per brief, IL typical (unverified).
Splitters `splitter-50-50`, `splitter-90-10` (excess 0.3dB) — theoretical split loss + typical
excess. `patch-panel` — passthrough, 0dB (loss is carried by the joints either side of it, per
SPEC.md §5.6/§6). `generic-host` — 8-slot chassis (Eth1/1…Eth1/8), organisational only.

## Examples (`examples/`)

Every example wires exactly one transceiver node per physical end (Tx and Rx both patched
in), never a separate Tx-only/Rx-only node pair — an unwired port on either side trips
`topology.unterminated_tx` / `topology.rx_no_signal` warnings (SPEC.md T23).

- **`simple-link/`** — single-file project: 2 hosts, 2 `generic-10g-lr` SFP+ (Tx and Rx both
  wired), 2x 10GBASE-LR signal over 2x 2km `g652d` span (one per direction, 2 `lc-patch`
  cords each way). Uses a 2km run and a lighter margins policy rather than the other
  examples' 10km/heavy-margins combination — see the file's own header comment for the link
  budget arithmetic (10GBASE-LR's IEEE worst-case budget is only 6.2dB, too tight for 10km +
  4 real connectors + a 4.2dB margins policy). 2 signals, both pass, zero warnings.
- **`dwdm-amplified/`** — split project (`project.yaml` + `sites/exchange-a.yaml` +
  `sites/exchange-b.yaml` + `spans.yaml`). SPEC.md test T18 as a real project: 4 tunable DWDM
  SFPs (`example-10g-dwdm-t18`, C21-C24, `tx_power_override_dBm` +3/0/-3/-6, Tx into the mux
  and Rx from the demux) into a 40ch/100GHz mux, a booster EDFA (`constant_gain`, 20dB,
  saturates), 80km of spliced G.652.D (60km+20km, `attenuation_dB_per_km: 0.2` override) and a
  matching demux — in both directions on separate fibre pairs. 8 signals: C21/C22 pass, C23
  warns, C24 fails `rx.power_low`, both boosters report `amp.output_saturated`, ~9dB channel
  imbalance flagged at every mux/demux common.
- **`cwdm-ring/`** — 4 sites (`sites/site1..4.yaml` + `spans.yaml`) in a physical ring, each
  adding its own CWDM channel (1471/1491/1511/1531nm, fixed `tx_power_override_dBm: 4`) and
  dropping the channel destined for it from two hops away, expressed through the intermediate
  site's single-channel add/drop module (`generic-cwdm-oadm-1471` etc., chained line-in/
  line-out per site). All 4 signals reach their intended Rx and pass with 2+dB margin, no
  topology warnings; per-span channel imbalance (a fresh add vs. a twice-expressed channel) is
  flagged but deliberately not equalised — see the file's header comment.

## Schema / brief notes

A few datasheet parameters could not be expressed exactly in the current
`@lumantite/schema` (`packages/schema/src/catalog.ts`):

- **100GBASE-LR4 is 4 wavelengths, the schema's `tx.wavelength` is one.** `TxWavelength`
  (catalog.ts) is a union of a single `wavelength_nm`, or a single `{plan, channel}` /
  `{plan, channels}`. There's no way to declare "4 fixed LAN-WDM lanes on one port". Modelled
  `generic-100g-lr4` with a nominal single `wavelength_nm: 1300` and put the real 4-lane grid
  under `x.lanes_nm` (an extension field, SPEC.md §5.8) — the engine can't use it for CD/loss
  per lane until the schema grows a multi-lane `tx.wavelength` variant.
- **BiDi needs a matched pair, the brief asked for one model.** `generic-1g-bidi` (Tx1310/
  Rx1490) has no counterpart at the other end of the fibre (which must transmit 1490/receive
  1310) — a single BiDi SFP model can't complete a link by itself. Added `generic-1g-bidi-u`
  (not in the requested id list) as the upstream mate; flagged here rather than silently
  expanding scope.
- **Finisar FTLX1471D3BCL / FTLX1671D3BCL are not CWDM parts.** Their part numbers look like
  CWDM wavelengths (1471nm / 1671nm) but the real Coherent/Finisar datasheets show these are
  grey 10GBASE-LR (1310nm/10km) and 10GBASE-ER (1550nm/40km) optics respectively — and 1671nm
  is outside the `cwdm-18` plan's 1271-1611nm range in any case. Modelled both as what the
  datasheets actually say (extending `generic-10g-lr` / `generic-10g-er`) rather than inventing
  CWDM parameters for a part that isn't CWDM; noted prominently in `transceivers.yaml`.
- **Mux `insertion_loss_dB` and `express_port.insertion_loss_dB` are independent `WlSpec`s
  with no required minimum shape** — `generic-dwdm-oadm-4ch`'s express IL is given as brief
  (`typ 1.0 / max 1.5`) with no `min`, which the schema allows (`Range3` members are all
  optional) but means the engine must fill `min` itself (per `docs/CONTRACT.md`
  `resolveTriple`).
- **A mux's `channel_ports` are matched by wavelength, not by wiring — so a multi-channel
  OADM model can silently misroute an unwired channel.** SPEC.md §5.4 / `mux.ts`: a signal
  arriving at `common` routes to whichever channel port's *channel* matches its wavelength,
  regardless of whether that specific instance actually has a fibre patched into that port.
  The cwdm-ring example originally gave every OADM instance the same 8-channel
  `generic-cwdm-8ch`-style model; at a site where only one of those 8 ports was wired, a
  passing-through (express-bound) signal whose wavelength happened to equal one of the
  *other, unwired* channel names still got routed to that dead port instead of falling
  through to `express_port`, producing `topology.unterminated_tx`. Fixed by giving each
  add/drop point its own single-channel model (`generic-cwdm-oadm-1471` etc., `channel_ports:
  ["1471"]` only) so a non-matching wavelength always falls through to express, as SPEC.md
  §5.4 intends for an OADM with an express path.
- Everything else validates cleanly against `DeviceModel` / `WavelengthPlan` / `ProjectFile` /
  `FragmentFile` as-is; no other structural gaps were hit.
