# CBECC Editor — User Guide

Single-file browser tool for editing CBECC-Com `.cibd25` / `.cibd22` project files without
opening CBECC-Com itself. Open `CIBD_editor.html` directly in Chrome or Edge — no install,
no server.

---

## Supported code years

| Year | Status | Notes |
|------|--------|-------|
| T24-2019 | **Not supported** | Source data not yet located (see below) |
| T24-2022 | **Full support** | Enums, App 5.4A occupancy defaults, App 5.4C ventilation rates |
| T24-2025 | **Full support** | Same as above |
| T24-2028 | **Partial** | Enum list only — see limitations below |

The code year is detected automatically from the file's `RulesetFilename` header and shown
next to the filename when you open a file (e.g. `project.cibd22 — T24-2022`).

### T24-2019 limitation

The CEC GitHub repo (`california-energy-commission/CBECC`) does not appear to include a
plain-text `T24N_2019 BEMEnums.txt` or the App 5.4A / 5.4C CSVs for 2019 — only a binary
`BEMBase.bin`. The 2019 occupancy category list is also substantially different from 2022+
(categories were reorganized in the 2022 cycle), so this is not a simple backfill.

Support is deferred until the source data is confirmed. If 2019 file support is needed,
contact the tool maintainer; the data would need to be extracted from the 2019 ACM Reference
Manual PDF or the CBECC-Com 2019 installer package.

### T24-2028 limitation

The SpcFunc enum list for 2028 is available (identical to 2022, sourced from
`T24N_2028 BEMEnums.txt`) and occupancy type assignment works normally. However, CEC has not
yet published the 2028 Appendix 5.4A or 5.4C tables, so **occupancy auto-fill is disabled**
for 2028 files:

- `OccDens`, `RecptPwrDens`, `GasEqpPwrDens` — not auto-filled on space type selection
- `VentPerArea`, `ExhPerArea` — not auto-filled
- `VentSpcFunc` — dropdown is available but ventilation rates fall back to 2025 values as a proxy

A banner notice is shown at the top of the Assign Occupancy Type step when a 2028 file is
loaded. When CEC publishes the 2028 tables, this will be wired up automatically.

Source to watch: `RulesetSrc/T24NRMF/Tables/` in the CEC GitHub repo for
`App5-4A_SpaceBySpace-T24N_2028.csv` and `App5-4C_Ventilation-T24N_2028.csv`.

---

## Workflow steps

Steps run in order. The sidebar shows completion status; completed steps can be re-opened at
any time.

| # | Step | What it does |
|---|------|-------------|
| 1 | **Open file** | Load a `.cibd25` or `.cibd22` file from disk |
| 2 | **Clean space names** | Strip or standardize Spc record names |
| 3 | **Confirm geometry** | 3D viewer — review floor plates, zone boundaries, surface areas |
| 4 | **Assign occupancy type** | Set `Spc.SpcFunc` and auto-fill occupancy/ventilation defaults from App 5.4A/5.4C |
| 5 | **Create HVAC systems** | Add / configure `AirSys`, `ZnSys`, `TrmlUnit` records for all system types |
| 6 | **Water-side plant** | Add `FluidSys`, chillers, boilers, cooling towers, pumps; auto-wire coil fluid references |
| 7 | **Confirm thermal zones** | Drag-and-drop zone-to-system assignment; live `TrmlUnit` cleanup |
| 8 | **Download** | Write the edited file back to disk |

### Optional step groups (collapsed by default)

These groups appear in the sidebar but are collapsed until toggled. All four are full editors.

| Group | Subtitle | What it edits |
|-------|----------|--------------|
| **Envelope** | FenCons / ConsAssm / WWR | Glazing library (`UFactor`, `SHGC`, `VT`, and the certification/framing enums on `FenCons`); opaque assembly layer stacks and cool-roof properties; every surface’s `ConsAssmRef` / `FenConsRef`, with bulk assignment per surface type and a flag on any surface pointing at the wrong kind of construction; window-to-wall ratio by orientation, with a target that rescales the window polygons in place. |
| **Lighting** | Spc.IntLPDReg W/ft² | Lighting power density per space, with the Appendix 5.4A default offered per row and in bulk; `IntLPDNonReg` and `LtgStatus`; and, for spaces that have `IntLtgSys` children, the luminaire counts and the `Lum` library (power, fixture type, lamp type). |
| **Process loads** | RecptPwrDens / ProcElec | All five internal-load densities on `Spc`, each with the ruleset’s own error and warning bands; Appendix 5.4A defaults for receptacle and gas equipment; the radiant / latent / lost heat-gain split; elevator and escalator loads. |
| **Renewables** | PVArray / Batt | Create, edit and delete `PVArray` (`DCSysSize`, module and array type, azimuth, tilt, power electronics, solar access, inverter efficiency) and `Batt` (`MaxCap`, `Ctrl`, charge/discharge or round-trip efficiency). |

### What these steps deliberately do not do

- **Opaque assemblies have no U-factor field.** CBECC computes the assembly U-factor from the
  `Mat` layer stack, so the layer list is the U-factor. Materials can be swapped, added and
  removed from the `Mat` records already in the file; adding a material that is not in the file
  needs CBECC’s own material library, which this tool does not carry.
- **No new lighting systems.** `IntLtgSys:AllowType` is conditioned on the parent space’s
  function across roughly 600 ruleset branches. Existing systems and luminaires are editable;
  creating one would mean guessing which allowances a space may claim.
- **Refrigeration density is reference-only.** `Spc:CommRfrgEPD` became NotInput in the 2022.3.0
  ruleset and CBECC discards anything written to it.
- **The prescriptive PV and battery sizing requirement is not checked.** It depends on building
  type and climate zone, which CBECC resolves from its own tables.
- **Rescaling a WWR rewrites geometry.** Window polygons are scaled about their own centres,
  which is in-plane, and a window is never pushed past the edge of its host wall — so an
  orientation can land short of the target, and the result says when it did. Re-run CBECC’s own
  geometry checks afterwards.

### Where the numbers come from

Nothing in these steps is transcribed by hand. Two generated tables back them, both read from
each code year’s **own** CBECC install:

| Table | Source | Regenerate / verify |
|-------|--------|--------------------|
| `FIELD_MODEL` | `T24*_ - Input Data Model.txt` — datatypes, units, enum option sets (branch by branch, not merged), validation bands, input classes | `node tools/extract_field_model.js [--check]` |
| `LOAD_DEFAULTS_54A` | `App5-4A_SpaceBySpace-T24N_<year>.csv` — interior LPD, receptacle, gas equipment, refrigeration | `node tools/extract_load_defaults.js [--check]` |

`--check` exits non-zero if the editor has drifted from the ruleset; the load-defaults check also
cross-checks the columns it shares with the occupancy step’s tables. Both run as part of
`node test_envelope_loads.js`.

Code-year handling follows the same rule as the rest of the tool: **option sets** may fall back to
another cycle, with a visible notice naming both years, while **numeric defaults never do** — a
cycle with no published table gets no defaults rather than another cycle’s numbers. The
differences are real: `Batt:Ctrl` offers Advanced DR Control under T24-2022 and not under
T24-2025, three Appendix 5.4A lighting-power rows differ between the cycles, and `Ceiling:Status`
is an input in 2025 and absent in 2022. A field that is not an input in the file’s cycle says so
rather than rendering an empty picker.

---

## HVAC system types supported

All standard T24NRMF nonresidential system types:

VRF, SZAC, SZHP, SZVAVAC, SZVAVHP, VAV, PVAV (with TrmlUnit), FPFC, WSHP, PTAC, PTHP,
MiniSplitAC, MiniSplitHP, Furnace, Radiant, Baseboard, PassiveBeam, EvaporativeCooler,
HV (heating AHU with Uncontrolled TrmlUnit per zone), Exhaust.

Water-side plant: FluidSys / FluidSeg / Chlr / Blr / HtRej / Pump, with automatic coil
fluid reference wiring. WSHP condenser coils wire to CondenserWater loops automatically.

---

## Known gaps / not yet built

- AirSys:SubType CRAC/CRAH for data-center zones
- DOAS-specific sizing fields
- Exhaust fan assignment step (planned as a separate step after HVAC)
- Session persistence / resumable workflow across browser sessions
- Full editing for envelope, lighting, process loads, and renewables (see above)
- T24-2019 file support
