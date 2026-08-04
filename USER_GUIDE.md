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

These groups appear in the sidebar but are collapsed until toggled. They are read-only audits
at present — full editing is planned for future sessions.

| Group | Subtitle | Current state |
|-------|----------|--------------|
| **Envelope** | ExtWall / Roof / Win | Audit view: flags surfaces missing `ConsAssmRef`. Editing construction assignments, U-values, and WWR is not yet implemented. |
| **Lighting** | LtgPwrDens W/sf | Audit view: shows lighting power density via `IntLtgSys` records. Fixture types, daylighting controls, and schedules are not yet editable. |
| **Process loads** | RecptPwrDens / ProcElec | Audit view: shows `RecptPwrDens`, `ProcElecPwrDens`, `ProcGasPwrDens` per space. Equipment schedules and rated power are not yet editable. |
| **Renewables** | PVArray / Batt | Audit view: shows PV array and battery storage records. Inverter efficiency, export control, and dispatch strategy are not yet editable. |

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
