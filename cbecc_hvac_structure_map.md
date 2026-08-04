# CBECC-Com HVAC modeling structure — reference map

Sourced from `RulesetSrc/T24NRMF/*.rule` and `T24N_2025 BEMEnums.txt` in the CEC's CBECC
repo, and cross-checked against real `.cibd25` project files in `Projects/2025/`
(not just rule text — one finding below only showed up by checking actual files).
Purpose: figure out everything a future "assign HVAC systems" workflow step would
need to handle, before building any of it.

## 1. The three independent reference roles per zone

A `ThrmlZn` can point at up to three *separate* systems, each doing a different job:

| Field | Job | 
|---|---|
| `PriAirCondgSysRef` | Primary heating/cooling |
| `VentSysRef` | Dedicated ventilation / outdoor air |
| `ExhSysRef` | Dedicated exhaust |

Any of these can point at either an `AirSys` or a `ZnSys` object, in any combination.
A zone doesn't need all three — a space can also just carry `VentSrc = "Natural"` or
`"Forced"` with no system reference at all if ventilation air simply comes along with
whatever's already conditioning it.

**Real-world usage note (found by checking actual files, not the rule text):**
`ExhSysRef` is barely used in practice — 1 of 33 real project files. Dedicated exhaust
fans (`ZnSys` with `Type = "Exhaust"`) are instead assigned through `VentSysRef` in
practically every real example. Don't build against `ExhSysRef` as the primary path;
build against `VentSysRef` handling either a real DOAS *or* an exhaust-only system.

## 2. The two system object families

**`AirSys`** — can serve one or many zones.
**`ZnSys`** — always one system per zone.

Every `Type` value found in the ruleset enum tables:

| `AirSys:Type` | `ZnSys:Type` |
|---|---|
| PVAV | SZAC, SZHP |
| VAV | SPVAC, SPVHP |
| SZAC, SZHP, SZVAVAC, SZVAVHP | FPFC, WSHP, PTAC, PTHP |
| HV | Furnace |
| DOASCV, DOASVAV | Radiant, EvaporativeCooler |
| Exhaust | Exhaust, VentilationOnly |
| | Baseboard, PassiveBeam |
| | **VRF**, MiniSplitAC, MiniSplitHP |

`AirSys` also has a `SubType` field (seen: `CRAC`) — required for zones whose
predominant function is "Data" (server/computer rooms); not yet traced further.

## 3. Structural wiring — two patterns, not one

**Pattern A — direct reference.** The zone's reference field points straight at the
system's name. Covers VRF, every single-zone `AirSys` type (SZAC, SZHP, SZVAVAC,
SZVAVHP), and most `ZnSys` types. This is all your example files use.

**Pattern B — central system + terminal unit.** Only for genuinely multi-zone `AirSys`
types (PVAV, VAV, HV). Confirmed against a real 25-zone office building:

```
AirSys "BaseAirSys6-Mid"          (central air handler)
  AirSeg "BaseSys6 SupAirSeg-Bot" (supply duct segment)
    TrmlUnit "BaseVAVTrmlUnit-4"  (VAV box)
      .PriAirSegRef → the AirSeg above
      .ZnServedRef  → the ThrmlZn it feeds
      CoilHtg "BaseVAVReheatCoil-4"  (reheat coil, nested under the VAV box)
ThrmlZn.PriAirCondgSysRef → "BaseAirSys6-Mid"  (set directly, same field as Pattern A)
```

The zone's own reference field works identically either way — what's different is the
extra `TrmlUnit`/`AirSeg` chain that has to exist for the multi-zone case.

## 4. Major discovery: HVAC objects use the same implicit-nesting grammar as geometry

This isn't a new mechanism to build — it's the **same file grammar** already handled
for `Story → Spc → ExtWall → Win`. Confirmed by checking raw file position:

```
AirSys "BaseAirSys6-Basement"
  AirSeg "BaseSys6 SupAirSeg"      (supply air segment)
    CoilClg "BaseSys6 CoilClg"     (nested under the supply segment)
    CoilHtg "BaseSys6 CoilHtg"
    Fan "BaseSys6 Fan"
  AirSeg "BaseSys6 RetAirSeg"      (return air segment)
    TrmlUnit "BaseVAVTrmlUnit-5"   (nested under whichever AirSeg precedes it)
      CoilHtg "BaseVAVReheatCoil-5"  (reheat coil, nested under the VAV box)
  OACtrl "BaseSys6 OACtrl"         (back at AirSys level)
AirSys "BaseAirSys6-Bot"           (next system starts)
```

`ZnSys` does **not** have explicit `CoilClgRef`/`CoilHtgRef`/`FanRef` fields in
practice (checked a real file — they're absent even where the fields exist in the
rule schema); coils and fans are positionally nested the same way. This means the
existing `buildHierarchy()` parent-tracking logic in the tool extends directly to
HVAC objects — same algorithm, different container/child type sets.

## 5. Plant equipment / fluid loops

Also positionally nested, one loop per `FluidSys`, cross-referenced by matching
`FluidSeg` *names* from whichever equipment consumes that loop:

```
FluidSys "BaseChWSystem"  (Type = ChilledWater)
  FluidSeg "BaseChWPrimSupSeg"
  FluidSeg "BaseChWPrimRetSeg"
  Chlr "Base Chlr"
    .EvapFluidSegInRef  → BaseChWPrimRetSeg
    .EvapFluidSegOutRef → BaseChWPrimSupSeg
    .CndsrFluidSegInRef / OutRef → (the separate condenser-water loop's segments)
  Pump "Base ChW Pump"
```

A `CoilClg` elsewhere (nested under some `AirSys`) then has its own
`FluidSegInRef`/`FluidSegOutRef` matching those same two segment names — that's the
entire linkage; no direct `Chlr`↔`AirSys` reference exists.

Three loop types seen in one real building: `HotWater` (→ `Blr`, boiler),
`CondenserWater` (→ `HtRej`, cooling tower), `ChilledWater` (→ `Chlr`, chiller).
`ServiceHotWater` loops (→ `WtrHtr`) use the identical pattern — this is the DHW
mechanism the tool flagged as missing back when `SHWFluidSegRef` first came up.

## 6. VRF is the outlier — cross-reference, not positional

```
VRFSys "CU-1"                (condensing unit — NOT positionally nested under anything)
  ← ZnSys "FC-1".."FC-6"     (indoor units, Type=VRF, .VRFSysRef → "CU-1")
    ← ThrmlZn                (.PriAirCondgSysRef → "FC-1", direct name reference)
```

`ZnSys.VRFSysRef` is a genuine cross-reference by name, not position — the only place
in the HVAC structure so far where that's true instead of implicit nesting.

## 7. Confirmed vs. still open

**Confirmed by reading rule source AND checking real files:**
- Zone → system reference framework (3 roles)
- Full `AirSys`/`ZnSys` Type enumeration
- Positional nesting for AirSys/AirSeg/Coil/Fan/TrmlUnit/OACtrl
- Plant loop nesting and FluidSeg name-matching
- VRF's VRFSysRef cross-reference
- `VentSysRef` >> `ExhSysRef` in real-world usage

**Not yet traced — would need checking before building that specific piece:**
- WSHP's shared condenser-water loop reference (didn't find the field yet)
- `AirSys:SubType` (CRAC/CRAH) requirements for computer-room zones
- Whether `Radiant`, `PassiveBeam`, `EvaporativeCooler` ZnSys types have their own
  unique linkage requirements beyond the general pattern
- DOAS-specific sizing/control fields beyond what's needed to just wire the reference

## Suggested staging, given this map

1. **Direct-reference systems** (VRF + every single-zone `AirSys`/`ZnSys` type) — no
   `TrmlUnit`/`AirSeg` chain needed, covers the majority of small/mid buildings,
   and is the pattern your own example files use.
2. **`VentSysRef` for dedicated ventilation/exhaust** — closes the loop on the
   restroom/lab exhaust rates already built in Step 2.
3. **Central VAV** (`AirSys` + `AirSeg` + `TrmlUnit`) — same nesting mechanism the
   tool already has for geometry, just a new container/child type set.
4. **Plant equipment** (`FluidSys`/`Chlr`/`Blr`/`HtRej`/`Pump`) — only needed once
   central VAV systems (or WSHP) are in scope; VRF and most `ZnSys` types are
   self-contained and never need this.
