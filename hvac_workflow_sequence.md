# Step 4 workflow sequence: HVAC systems

Follows Step 3 (1:1 space→zone mapping). Mirrors reading a mechanical schedule: name
the systems that exist, assign what each one serves, then let the system type
determine what has to be built underneath it. Grounded in the object/field names and
patterns confirmed in `cbecc_hvac_structure_map.md`, plus a few new findings below
that came from checking one more layer of real examples.

## New findings since the structure map

- **The zone→system reference is universal, regardless of system complexity.**
  Even a simple single-zone packaged DX unit sets `ThrmlZn.PriAirCondgSysRef`
  directly to the `AirSys` name — the *same* field VRF and VAV both use. A
  single-zone `AirSys` additionally carries its own `CtrlZnRef` pointing back at
  the zone, but that's on top of, not instead of, the direct reference. This means
  "point the zone at its system" is step one, always, no matter what type is chosen
  — type only changes what gets built *underneath* that system.
- **VRF indoor units do have nested coils** (`CoilClg`/`CoilHtg`, `Type = "VRF"`) and
  a nested `Fan` — confirmed by checking file position, matching record counts I'd
  noticed earlier (6 ZnSys, 6 CoilClg, 6 CoilHtg, 6 Fan) but hadn't verified were
  actually paired 1:1.
- **Three coil-type families exist**, and they determine whether a fluid loop is
  needed at all:
  - `ChilledWater` / `HotWater` — central plant required (Stage 5 below)
  - `VRF` — self-contained, refrigerant-based, no loop
  - `DirectExpansion` / `Furnace` — self-contained, no loop (packaged DX/gas)

## Stage 1 — Name the systems (the "mechanical schedule" pass)

For each system on the schedule, user picks a **system family** (which determines
whether it becomes an `AirSys` or `ZnSys` record) and a **Type**, then names it.
This is just `Type` + `Name` — everything else defaults or gets built in later
stages.

| User picks | Creates | Typical `Type` |
|---|---|---|
| VAV / PVAV | `AirSys` | VAV, PVAV |
| Fan Coil (central, non-VRF) | `AirSys` | HV |
| Packaged DX (single zone) | `AirSys` | SZAC, SZHP, SZVAVAC, SZVAVHP |
| VRF indoor unit | `ZnSys` | VRF |
| Fan Coil (zone-level) | `ZnSys` | FPFC |
| WSHP indoor unit | `ZnSys` | WSHP |
| PTAC / PTHP | `ZnSys` | PTAC, PTHP |
| Furnace / Radiant / Baseboard / etc. | `ZnSys` | (matches selection) |

`Type` is `Compulsory` in CBECC — the record isn't valid without it, so this has to
be forced at creation, not left as an optional field to fill in later.

## Stage 2 — Assign zones to each system

Multi-select zones (reuse the exact mechanism already built for Step 3's zone
merging), pick a system from Stage 1, assign.

**What this sets depends on the system's zone-count:**

- **Single-zone systems** (VRF `ZnSys`, packaged DX `AirSys`, FPFC, PTAC, etc.) —
  exactly one zone allowed per system. Sets `ThrmlZn.PriAirCondgSysRef` directly to
  the system name. If it's a single-zone `AirSys`, also set `AirSys.CtrlZnRef` back
  to the zone (the confirmed bidirectional pattern).
- **Multi-zone systems** (VAV, PVAV, HV) — many zones per system, but each needs its
  own `TrmlUnit`. Selecting zones here should queue up "create a `TrmlUnit` for each
  assigned zone" for Stage 3, not just set a reference directly.

This is the natural point to enforce CBECC's real constraint (`ZoneSystem serves
both ResOtherZn and ThrmlZn` is a hard error) — cap single-zone system types at one
zone in the UI itself, rather than letting the user assign several and fail at
compile time.

## Stage 3 — Type-driven auto-creation of subcomponents

This is the "unlock" logic — branches entirely on the Stage 1 Type choice.

**VRF indoor unit (`ZnSys`, Type=VRF):**
- Auto-create nested `CoilClg` (Type=VRF) + `CoilHtg` (Type=VRF) + `Fan`.
- Prompt for `VRFSysRef` — pick an existing `VRFSys` (condensing unit) or create one.
  This is the one place in the whole structure where the link is a cross-reference
  by name rather than positional nesting, so it needs its own explicit UI control,
  not just an auto-unlock.

**Packaged DX (`AirSys`, Type=SZAC/SZHP/etc.):**
- Auto-create `AirSeg` (supply) → nested `CoilClg` (Type=DirectExpansion) + `CoilHtg`
  (Type=Furnace or HeatPump, depending on whether it's an HP variant) + `Fan`.
- Auto-create `AirSeg` (return).
- Auto-create `OACtrl`.
- No fluid loop, no plant prompt — self-contained.

**VAV / PVAV / HV (`AirSys`, multi-zone):**
- Auto-create the supply/return `AirSeg` pair, nested `Fan`.
- For coils: prompt for **Type** first (`ChilledWater`/`HotWater` vs.
  `DirectExpansion`/`Furnace`) since that decision determines whether Stage 5
  (plant) gets triggered at all.
- For each zone assigned in Stage 2: auto-create a `TrmlUnit`, with
  `PriAirSegRef` → the supply `AirSeg` and `ZnServedRef` → that zone. Prompt
  whether each needs its own reheat `CoilHtg` (common for VAV-reheat boxes).
- Auto-create `OACtrl`.

**WSHP (`ZnSys`, Type=WSHP):**
- Auto-create nested `CoilClg`/`CoilHtg`/`Fan`.
- Flagged as unverified in the structure map — the shared condenser-water loop
  reference field wasn't found yet. Before building this branch specifically, trace
  that field against a real WSHP example the same way the others above were
  checked, rather than guessing the field name.

**Furnace / Radiant / Baseboard / PassiveBeam / EvaporativeCooler (`ZnSys`):**
- Each likely has its own minimal, mostly self-contained component set. Not
  individually verified yet — check one real example per type before building,
  same discipline as everything above.

## Stage 4 — Exhaust systems

Separate pass, after the primary conditioning systems exist — this is where the
`ExhPerArea`/`ExhPerSpc` values already computed back in Step 2 finally connect to
something real.

- Create exhaust systems the same way as Stage 1 (`ZnSys`, Type=Exhaust — or `AirSys`
  Type=Exhaust for a central exhaust system serving several zones).
- Assign zones the same way as Stage 2.
- **Wire the reference through `ExhSysRef`** — *corrected 2026-08-19, superseding
  the earlier note in this doc that said `VentSysRef`.* The T24_2025 Input Data Model
  is unambiguous: `ThrmlZn:ExhSysRef` is an ObjectRef restricted to
  `AirSys:Type = "Exhaust"` / `ZnSys:Type = "Exhaust"`, while `ThrmlZn:VentSysRef`
  points at the ventilation system (`SysRefStatus = "HVAC"`). A wider corpus sweep
  agrees: `ExhSysRef` appears in 30 of the 216 reference project files, and
  `OffLrg-PrkgLabKitchen.cibd25` shows both fields in use side by side on the same
  model — conditioned zones carry `ExhSysRef = "LabExhaust System"` while the parking
  garage's unconditioned zone carries `VentSysRef = "PrkgGarVent System"` with
  `VentSrc = "Forced"`. The earlier 1-of-33 count was drawn from too small a sample.
- Auto-create the nested `Fan`, and set the parent's `ExhSysType` /
  `ExhOperMode` / `ExhCtrlMthd`. `ExhCtrlMthd`'s valid set is conditioned on
  `ExhSysType`: General/Laboratory/CommercialKitchen take the
  ConstantFlow/VariableFlow fan trio, ParkingGarage takes `NoCOControl`/`COControl`.
- **Two families, not one.** `Exhaust` is the one Type that exists as both an
  `AirSys` (central: `AirSeg` with `Type = "Exhaust"` + `Fan`) and a `ZnSys`
  (zone-level exhaust fan: a bare nested `Fan`, no `AirSeg` — `ZnSys` has no
  `AirSeg` child in the data model). One `ZnSys` exhaust fan can serve several
  zones. Confirmed against `OffLrg-PrkgLabKitchen.cibd25` and
  `OffMed-FanPowerAdj.cibd25` respectively.

This stage can also cover genuine dedicated ventilation (DOAS) the same way — a
zone's `VentSysRef` pointing at a real `AirSys` (Type=DOASCV/DOASVAV) instead of an
exhaust-only system. Same field, same UI, different Type.

## Stage 5 — Linked water-side systems (only if triggered)

Only reachable if Stage 3 created a coil with `Type = ChilledWater` or `HotWater`
anywhere in the building. If every system chosen was VRF/DX/self-contained, this
stage never has to appear at all.

For each loop type actually needed (`ChilledWater`, `HotWater`, and
`CondenserWater` if a chiller was created):

- Create one `FluidSys` (Type matches the loop).
- Auto-create the supply/return `FluidSeg` pair nested under it.
- Prompt for the actual equipment: `Chlr` (chiller) for ChilledWater,
  `Blr` (boiler) for HotWater, `HtRej` (cooling tower) for CondenserWater — each
  auto-created nested under the `FluidSys`, with a `Pump` alongside.
- **Retroactively wire the coils created in Stage 3**: every `CoilClg`/`CoilHtg`
  with a matching `Type` gets its `FluidSegInRef`/`FluidSegOutRef` set to this new
  loop's segment names. This is the step that actually closes the connection —
  the coil and the plant equipment never reference each other directly, only
  through matching `FluidSeg` names, so the tool has to do this wiring explicitly
  rather than relying on any single object to "know" about the other end.
- If a chiller was created, its condenser side needs the `CondenserWater` loop too
  — this can cascade into needing a `HtRej`/tower even if the user only asked for
  a chiller, so the prompt sequence needs to handle that dependency rather than
  leaving a chiller with a dangling condenser reference.

## Open items before building, in priority order

1. WSHP's shared loop reference field — needed before Stage 3's WSHP branch can be
   built correctly.
2. One real example each for Radiant, Baseboard, PassiveBeam, EvaporativeCooler —
   needed before those Stage 3 branches can be built with any confidence.
3. ~~`AirSys:SubType` (CRAC/CRAH) requirement for Data-function zones.~~ **Done
   2026-08-19 (v1.15.0).** Traced and built. `AirSys:SubType` is a Defaulted input
   whose enum is Packaged3Phase / Split3Phase / Packaged1Phase / Split1Phase / CRAC /
   CRAH / NA; `Type = "HV"` and `Type = "Exhaust"` are restricted to `NA`, everything
   else gets the full list. `AirSys:Config` is CondRequired when `SubType = "CRAC"`
   (eight floor/ceiling-mount options), but no file in the reference corpus writes it,
   so the tool leaves it blank unless the user picks one. It is *not* a required field
   — rather, it changes the baseline: `BaselineHVACSystems-T24N.rule` models a
   Computer Room zone as CRAC when total building computer-room power is < 800 kW and
   CRAH at or above it (and switches CRAC from SZAC to SZVAVAC above 17.5 kW zone
   power), and `HVACSecondary-CoilCooling-Capacity.rule` branches CoilClg capacity and
   efficiency on `SubType = "CRAC"`. The tool therefore *advises* rather than compels:
   a system serving a `SpcFunc = "Computer Room"` space is flagged when its SubType
   isn't CRAC or CRAH.
4. ~~DOAS-specific fields beyond the bare reference.~~ **Partly done 2026-08-19
   (v1.15.0).** The sizing fields are zone-side, not system-side:
   `ThrmlZn:SizeForDOAS` (integer flag), `SizeForDOASCtrl`
   (Neutral / NeutralDehumidifed / Cold — the ruleset's own spelling),
   `SizeForDOASTempLow` and `SizeForDOASTempHi` (°F, CBECC warns outside 50–90).
   All four are Optional inputs and none of the 216 reference project files set any of
   them, so the tool writes nothing until sizing is switched on for a zone. Still
   untraced: the DOAS system's own control fields (`ClgCtrl` and its reset setpoints
   are available to DOASCV/DOASVAV, minus `WarmestReset`) and `OACtrl` sizing.
