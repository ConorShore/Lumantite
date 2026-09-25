# FS.com SFP / SFP+ source data

Hand-transcribed FS.com datasheet values for 100M, 1G and 10G SFP/SFP+ optics. This directory is
**input** to `scripts/gen-fs-transceivers.ts`, which writes `catalog/transceivers-fs.yaml`
(generated; do not hand-edit). Regenerate with:

```
npx tsx packages/catalog/scripts/gen-fs-transceivers.ts
```

Only physical/optical characteristics are recorded. Brand compatibility (the "Cisco
compatible" coding FS sells each optic under) is deliberately out of scope. RJ-45 copper
modules, DACs/AOCs and CSFP (two-channel compact SFP) parts are excluded.

## Files

| file | contents |
|---|---|
| `100m.yaml` | 100BASE-FX/LX/EX/ZX and 100M BiDi SFPs |
| `1g.yaml` | 1000BASE-SX/LX/EX/ZX/EZX and 1G BiDi SFPs |
| `1g-wdm.yaml` | 1G CWDM / DWDM SFPs |
| `10g.yaml` | 10GBASE-SR/LRM/LR/ER/ZR and 10G BiDi SFP+ |
| `10g-wdm.yaml` | 10G CWDM / DWDM (fixed and tunable) SFP+ |

## Row format

Each file is a top-level YAML sequence; one row per FS part number (P/N) as FS's datasheet
lists it. Commercial- and industrial-temperature parts are separate rows (FS gives them
different optical figures in several cases).

```yaml
- pn: SFP-10GLR-31            # FS P/N exactly as printed in the datasheet (required, unique)
  id: fs-sfp-10glr-31         # optional; default is "fs-" + slugified pn. Must be unique.
  fs_products: [11555]        # fs.com product ids this row corresponds to (from the listings)
  title: 10GBASE-LR SFP+, 1310nm, 10km, SMF   # short description (required)
  form_factor: SFP+           # SFP | SFP+
  rate_Gbps: 10               # 0.1 (100M), 1 (1G), 10 (10G). Dual-rate 1/10G parts: 10.
  reach_km: 10                # FS's rated reach
  media: smf                  # smf | mmf
  connector: lc-upc           # joint id from catalog/joints.yaml (lc-upc, sc-upc, ...)
  temp: commercial            # commercial | industrial

  # --- exactly one of the three wavelength forms ---
  wavelength_nm: 1310                          # grey duplex optic
  bidi: { tx_nm: 1270, rx_nm: 1330 }           # single-fibre BiDi (one bidi port)
  channels:                                    # WDM
    plan: cwdm-18                              # an existing wavelength-plan id
    ids: ["1471", "1491", ...]                 # channel ids in that plan FS sells this family on
    tunable: false                             # true = one module tunes across ids;
                                               # false = FS sells one fixed SKU per channel

  tx_power_dBm: { min: -8.2, max: 0.5 }        # typ optional
  rx_sensitivity_dBm: -14.4                    # average-power sensitivity (not OMA) where given
  rx_overload_dBm: 0.5
  rx_range_nm: [1260, 1355]                    # optional; datasheet receiver wavelength range
  cd_tolerance_ps_nm: 1600                     # optional; scalar = ±, or { min, max }
  source: "https://resource.fs.com/... (Table 3, p.14)"   # the PDF the numbers came from
  verified: true              # must be true: every number above was read from an FS datasheet
  notes: "..."                # optional: cross-checks made, channel-list narrowing
```

### Conventions

- **CWDM naming.** FS labels CWDM channels by the pre-2003 nominal wavelength (1270, 1290,
  ... 1610nm). The ITU-T G.694.2 grid used by `cwdm-18` is 1271 ... 1611nm; FS "1470nm" is
  channel `"1471"`, and so on.
- **DWDM 100GHz.** FS's fixed DWDM SFP/SFP+ families span C17-C61 (191.7-196.1 THz), wider
  than `dwdm-c-100ghz-40` (C21-C60). They use `dwdm-c-100ghz-45` (C17-C61).
- **BiDi Rx range.** Where the datasheet gives no receiver wavelength range for a BiDi part,
  the generator does not invent one; record the datasheet range in `rx_range_nm` when it
  exists.
- **Datasheet typos.** The combined datasheets contain obvious typing errors (e.g. a positive
  Rx sensitivity). A part whose used figures are affected is excluded (below), not corrected.

## Exclusions — accuracy over coverage

A part is left out of the catalog entirely (its row moved to `excluded/<file>.yaml` with an
`excluded:` reason, which the generator never reads) if any of these holds:

- two FS sources (combined datasheet editions, single-product datasheets, listings) give
  different values for a figure the catalog uses — even when one looks like a typo;
- the datasheet row is garbled or ambiguous and a value had to be inferred or assigned;
- a value was copied from a sibling part rather than published for this part;
- the only sensitivity published is OMA (using it as average power would overstate margin);
- it is a BiDi part whose mate is excluded (half a pair cannot make a link).

The generator rejects any row without `verified: true`. Only the channel list may be narrowed
to what every source agrees FS sells (e.g. a datasheet naming 18 CWDM wavelengths where the
listing sells 8); such cases are noted in `notes`.
