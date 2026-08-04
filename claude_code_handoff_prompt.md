# Continuing the CBECC .cibd25 Editor project in Claude Code

Paste everything below as your first message to Claude Code in this project's directory.

---

## What this is

A browser-based, single-file HTML tool (`CIBD_editor.html`) for editing CBECC-Com 2025
(California Title 24 non-residential energy compliance) `.cibd25` project files. These are
text-based BEMBase-format files exported from IES-VE, hand-editing them in Notepad++ is what
this replaces.

The tool has two halves:
1. A raw record browser/editor ("Records" mode) — power-user escape hatch for direct field edits.
2. A guided multi-step **Workflow** that walks a freshly-exported file through to a
   compliance-ready state: Open file → Clean space names → Confirm geometry (embedded 3D view)
   → Assign occupancy type → Create HVAC systems → Confirm Thermal Zones → Download.

There's also a standalone "3D View" mode (legacy, kept as-is per explicit request) and a
persistent mini 3D preview + pop-up modal that lives in the workflow sidebar.

Everything lives in one HTML file with embedded `<script>` (~3300 lines) so it can be opened
directly in a browser with no build step and distributed as a single file. **Preserve that
distribution model** — if you reorganize the source for easier editing, the shippable artifact
still needs to be one self-contained HTML file (Three.js/OrbitControls loaded from CDN via
`<script src>` is fine and already how it works).

## Where things are

- `CIBD_editor.html` — the actual tool. This is the only deliverable that matters.
- `cibd25_tools.py` — a parallel Python CLI (parse/batch-edit/serialize) for the same file
  format, useful for quick verification without touching the browser tool.
- `run_full.js` + `three_stub.js` — a jsdom-based test harness that loads the *entire real app*
  (not extracted fragments) into a simulated browser, with a minimal Three.js stub so file loads
  don't crash on WebGL calls that don't exist in jsdom. This is how every feature in this project
  has been tested — described in detail below, reuse it, don't rebuild it.
- `cbecc_hvac_structure_map.md` and `hvac_workflow_sequence.md` — research notes on the HVAC
  object model and the staged build plan. Read both before touching anything HVAC-related.
- A local CBECC source/example corpus (ask the user where they've placed it, or check for a
  `CBECC/` directory) containing the actual ruleset source (`RulesetSrc/T24NRMF/*.rule`,
  `*BEMEnums.txt`, `*BEMBase*.txt`) and hundreds of real `.cibd25`/`.cibd22` project files under
  `CBECC/Projects/2025/...`. **This corpus is the ground truth for everything.** Nearly every
  design decision in this tool was made by grepping real files and real ruleset source, not by
  inferring from documentation or general HVAC knowledge.

## The one rule that matters more than any other

**Never assume the file format works a certain way. Check.** This project has a long history of
real bugs that came from reasonable-sounding assumptions turning out to be wrong, and every one
of them was caught by going back to real files:

- Assumed `PriAirCondgSysRef` and `VentSysRef` used the same indexed format — wrong, confirmed
  by grep that `VentSysRef` is a plain attr, `PriAirCondgSysRef` is indexed (`[1]`).
- Assumed cooling coil type correlates with VAV vs PVAV — wrong, tabulated across the whole
  corpus and found both types use both `ChilledWater` and `DirectExpansion`.
- Assumed each `Spc`'s surfaces (`UndgrFlr`/`Roof`/`ExtWall`/`IntWall`) are the only geometry
  attached positionally after a `Spc` header — wrong, each `Spc` also has its *own* leading
  footprint polygon that isn't a wall/floor/roof at all. Missing this caused a real, confirmed
  rendering bug (a stray polygon overwriting the *previous* space's last wall). Root-caused by
  literally printing the raw record sequence and tracing it by hand before writing the fix.
- Assumed CBECC tolerates any record ordering — wrong, `ThrmlZn` records must appear before the
  materials/construction library section or CBECC-Com throws ~100 cascading parse errors on open
  (confirmed against a real error log the user pasted from an actual CBECC-Com session).
- Assumed serializing with `\n` was fine — wrong, CBECC-Com's own files are 100% CRLF, and a
  browser-produced `\n`-only file trips up the parser.

When in doubt: `grep` the ruleset source and the example corpus before writing code, the same
way this whole project has been built. If a claim can't be verified against a real file, say so
explicitly rather than presenting it as fact.

## Critical, non-obvious file-format facts (all confirmed against real files)

- **Not XML.** Flat BEMBase records: `Type   "Name"  \r\n` header, then `   key = value\r\n`
  attribute lines, terminated by `   ..\r\n`. A blank line separates records. File starts with
  `RulesetFilename   "T24_2025.bin"` (no `..` terminator) and ends with `END_OF_FILE`.
- **CRLF only.** Every real file is 100% `\r\n`. The serializer must write `\r\n` explicitly —
  don't rely on `open()`/platform defaults; on any platform other than native Windows text mode
  you'll get plain `\n` and produce a file that throws parse errors in real CBECC-Com.
- **Geometry is positional, not reference-based.** `Story` → `Spc` → (its footprint polygon,
  unused for rendering) → `UndgrFlr`/`Roof`/`ExtWall`/`IntWall` (each optionally followed by its
  own `PolyLp` + `CartesianPt` sequence) → next `Spc`. Whatever surface/opening record most
  recently preceded a `PolyLp` owns the points that follow. Resetting the "current owner" state
  correctly on every `Spc`/`Story` boundary is what the earlier bug was about — do not regress it.
- **Indexed vs plain reference fields matter and are NOT consistent across similar-looking
  fields.** `PriAirCondgSysRef[1]` is indexed. `VentSysRef`, `ZnServedRef`, `PriAirSegRef`,
  `AdjacentSpcRef` are plain. Always grep a real file before assuming which.
- **`order[]` tracking is load-bearing.** The parser builds each record as `{type, name, attrs,
  order}` where `order` is the list of attribute keys *in the order they should serialize*.
  Setting `rec.attrs.Foo = x` directly without also pushing `"Foo"` into `rec.order` means the
  value silently never gets written to the output file, even though it looks correct in memory
  and even cascades correctly into dependent calculations. This was a real, previously-shipped
  bug that affected every "new" field (anything not already present in the original IES export).
  **Always use the `setPlainAttr(rec, key, value)` / `setIndexedAttr(rec, key, idx, value)` /
  `deletePlainAttr(rec, key)` helpers already in the file — never assign `rec.attrs.X` or
  `delete rec.attrs.X` directly.** Deleting without cleaning up `order` is worse than not
  deleting: it serializes the literal text `Key = undefined` into the output file.
- **New records can't just be pushed to the end of `doc.records`.** Real files have trailing
  library/system content already in them; naive appending can land a new `ThrmlZn` after the
  materials library (breaks on open in real CBECC-Com) or similar. See `getOrCreateThrmlZn` and
  `createSystem` for the established "insert relative to the last record of the same category,
  or a sensible anchor point" pattern — extend it, don't bypass it.
- **`Spc.SpcFunc` and CBECC's own compliance-rule enum table are the single source of truth for
  occupancy type strings** — sourced verbatim from `RulesetSrc/T24NRMF/T24N_2025 BEMEnums.txt`,
  cross-checked byte-for-byte against the embedded list in the tool more than once after bugs
  were traced there. If you ever touch this list, re-diff it against source, don't hand-edit.

## What's built (all tested against real files before shipping, not just written and assumed working)

**Workflow steps**, in order:
1. **Open file** — lands here by default on page load (not an empty Records view).
2. **Clean space names** — strips IES's auto-generated `_XXXXXXXX` suffix, cascades the rename
   to every `*Ref` field across the whole document, animated per-row feedback on apply.
3. **Confirm geometry** — the 3D viewer, embedded *inside* the step panel (not a separate mode
   takeover) so the step sidebar never disappears. This required a real architectural fix: see
   "3D viewer relocation system" below, it's subtle and easy to accidentally re-break.
4. **Assign occupancy type** — sets `SpcFunc` and cascades every dependent default from CBECC's
   own Appendix 5.4A/5.4C tables (`RecptPwrDens`, `VentSpcFunc`, `VentPerArea`, `VentPerPerson`,
   `ExhPerArea`, fixture-based exhaust for restrooms, lab makeup-air override). Checkbox
   multi-select + bulk-apply via a searchable combobox (not a native `<select>`).
5. **Create HVAC systems** — see below, this is the most complex step.
6. **Confirm Thermal Zones** — a System → Zone → Space collapsible tree with drag-and-drop
   reassignment and inline zone rename (cascades correctly). Multi-zone types not yet fully
   auto-built (see below) render read-only here on purpose.
7. **Download edited file** — final step.

**HVAC system types implemented in "Create HVAC systems"**, each verified against real project
files before being marked supported (see `systemTypeMeta`/`SYSTEM_TYPES` for the full list
including everything still "manual setup only"):
- **VRF** (ZnSys) and **packaged single-zone DX/HP** (SZAC/SZHP/SZVAVAC/SZVAVHP, AirSys) —
  single-zone types. Assigning multiple spaces to the same system *mandatorily* merges them into
  one shared zone (CBECC hard constraint, not a heuristic).
- **Exhaust** (ZnSys, `Type="Exhaust"`) — uses `VentSysRef` (plain attr), builds a Fan-only
  child (no coils, confirmed against a real hotel project file), multi-zone by convention (each
  space keeps its own zone, no forced merge).
- **VAV / PVAV** (AirSys, central multi-zone) — the big one. AHU trunk
  (`SupAirSeg → CoilClg → CoilHtg → Fan → RetAirSeg → OACtrl`) built once on system creation;
  each zone assignment adds a `TrmlUnit(Type=VAVReheatBox) + CoilHtg` pair positioned immediately
  before `OACtrl`. Cooling coil type (`ChilledWater` vs `DirectExpansion`) is a user choice at
  creation time, not derivable from system type — confirmed by tabulating the whole corpus.
  Deletion cleans up every `TrmlUnit` and clears `PriAirCondgSysRef` from every zone that had one.

**Not yet built** (the honest remainder of the staged plan):
- **Water-side plant equipment** — `FluidSys`/`FluidSeg` pairs, `Chlr`/`Blr`/`HtRej`/`Pump`.
  This is what VAV's `ChilledWater`/`HotWater` coil `FluidSegInRef`/`FluidSegOutRef` fields
  actually need to point at for a fully wired system — **this is genuinely the next piece**,
  the user was about to start it when this handoff happened.
- Other zone-level types marked "manual setup only": WSHP (condenser-water loop reference not
  yet verified), PTAC, PTHP, MiniSplitAC/HP, Furnace, Radiant, Baseboard, PassiveBeam,
  EvaporativeCooler.
- `AirSys:SubType` (CRAC/CRAH) for data-center-type zones.
- DOAS-specific sizing/control fields beyond a bare system reference.

**3D viewer**: reconstructs geometry purely from the positional hierarchy above. Surface-type
and thermal-zone color modes, each with a legend. Exterior walls fully opaque, everything else
partially see-through. Searchable space list with a floor-number filter (floor tracked via a
sequential index incremented on each `Story` record encountered).

**3D viewer relocation system** — read this before touching anything 3D-related. There is
exactly one Three.js canvas/renderer/scene (`#canvasWrap` inside `#viewer3d`, plus its sibling
`#zonePanel` with all the color/legend/space-list controls). It gets moved between four possible
homes depending on context: the standalone "3D View" topbar mode (`#main`), the "Confirm
geometry" step's embedded panel, a persistent small preview in the workflow sidebar
(`#miniViewerHost`, canvas only, no controls — no room for them at that size), and a full-size
pop-up modal (`#viewerModalBody`, canvas + full controls). `syncViewerHome()` is the central
dispatcher; `parkViewer3DSafely()` unconditionally moves `#viewer3d` to `#main` *before* any
step's content gets wiped via `innerHTML`, because a genuinely serious bug happened when this
wasn't unconditional: re-clicking the *same* already-active step re-ran the render function,
which wiped `#stepDetail.innerHTML` while `#viewer3d` was still parented inside the content being
destroyed — silently deleting the entire viewer (canvas, renderer, all controls). It looked like
"the 3D view goes blank and clicking it does nothing" from the user's side and took careful
step-by-step tracing to find. **Any change to step rendering or mode switching must preserve the
invariant that `#viewer3d` is relocated to a safe parent before, not after, destructive
`innerHTML` operations.**

## Testing discipline — how this project actually gets tested

Every feature in this build was verified with the same method, not just written and eyeballed:

1. `python3 -c "import re; html=open('CIBD_editor.html').read(); js=re.findall(r'<script>([\s\S]*?)</script>', html)[0]; open('extracted.js','w').write(js)"` then `node --check extracted.js` for a fast syntax check after every edit.
2. **Real functional testing uses `run_full.js`**, which loads the *actual* HTML file into jsdom
   with `runScripts: "dangerously"`, stubs just enough of `THREE`/`requestAnimationFrame` for
   file-load code paths to not throw, and drives everything through real DOM events (`.click()`,
   checkbox `change` events, real button clicks) — not by slicing out JS fragments and eval'ing
   them separately. That fragment-slicing approach was tried early in this project and produced
   misleading results (stale closures, missing function scopes); `run_full.js` replaced it and
   should be the template for any new test script. See it for the exact stub setup.
3. Tests load real files from the local CBECC corpus (`BPP_2025_*.cibd25`, or reach into
   `CBECC/Projects/2025/...` for type-specific structural examples) — never synthetic fixtures
   unless a specific edge case genuinely has no real example (state that explicitly if so).
4. For anything serialization-related, always test the full round trip: build the change in
   memory, call `serializeDoc(doc)`, re-`parseDoc()` the output, and confirm the change survived
   — in-memory-only checks have missed real bugs (the `order[]` issue) that only manifested after
   a save/reload cycle.
5. Before shipping any fix, re-run a broad regression check across the *other* already-built
   steps too, not just the thing that changed — several real regressions in this project were
   caught this way (e.g., the viewer-relocation fix needed re-confirmation that the standalone
   3D View topbar mode still worked afterward).

## A note on continuity

This is a long-running project with a lot of accumulated, hard-won context above. If anything in
this brief seems to conflict with what you find in the actual file, trust the file — but flag the
discrepancy to the user, since it may mean something regressed (this has happened before, after
tool infrastructure hiccups reverted in-progress edits — always verify current file state before
assuming a previously-described fix is actually still present).

Start by opening `CIBD_editor.html` and `run_full.js`, skim `cbecc_hvac_structure_map.md` and
`hvac_workflow_sequence.md`, and confirm you can run the existing test suite before making any
changes. Then pick up with water-side plant equipment (`FluidSys`/`FluidSeg`/`Chlr`/`Blr`/
`HtRej`/`Pump`) as the next feature, following the same source-verification-first process as
everything above: find real files with each equipment type, trace the exact positional structure
and reference fields by hand, and only then write code.
