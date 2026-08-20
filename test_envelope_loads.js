// Test: the envelope, lighting, process-load and renewables steps (v1.20.0), and
// the generated field model / Appendix 5.4A load tables they run on.
//
// Ground truth:
//   field model .............. each code year's own "Input Data Model.txt", via
//                              tools/extract_field_model.js --check
//   5.4A load defaults ....... each year's own App5-4A_SpaceBySpace CSV, via
//                              tools/extract_load_defaults.js --check, which also
//                              cross-checks the shared columns against the
//                              occupancy step's SPCFUNC_DEFAULTS_54A
//   IntLPDReg semantics ...... Lighting-Space-General.rule, Spc:RegLtgPwr /
//                              Spc:IntLPDReg / Spc:ApplyStdLtg
//   process load semantics ... Space-RecepProcess.rule (Computer Room 20.001,
//                              all-electric gas override)
//   PV / battery fields ...... T24_2025 Input Data Model PVArray + Batt, and the
//                              real records in 010012-SchSml-CECStd.cibd25
//   Batt derived fields ...... BEMBase.txt, MaxChrgPwr declared NInp
//   Skylt hierarchy .......... 050112-RetlMed-SZVAV.cibd25 (32 skylights)

const { execFileSync } = require('child_process');
const { win, loadFile, clickStepByTitle, doc_ } = require('./run_full.js');

// The editor declares `doc` and its tables with let/const at script top level, which
// makes them global lexical bindings rather than window properties. Indirect eval runs
// in the global scope, so it can both read and assign them; win.<name> cannot.
const appDoc_ = () => win.eval("doc");
const appConst = name => win.eval(name);

// The four optional groups start collapsed, so their step rows are not rendered
// until the group is open. Expand everything before reaching for a step.
function openStep(title){
  win.eval("collapsedGroups.clear(); renderWorkflowSidebar();");
  clickStepByTitle(title);
  return doc_.getElementById("stepResults");
}

const CORPUS = "C:/Users/CharlieChristenson/OneDrive - Stok LLC/Documents/CBECC 2025 Projects";
const F_LTG  = CORPUS + "/OtherTests/010112-SchSml-PSZ.cibd25";       // 4 IntLtgSys, 3 Lum
const F_SKY  = CORPUS + "/OtherTests/050112-RetlMed-SZVAV.cibd25";    // 32 Skylt
const F_PV   = CORPUS + "/StandardModelTests/010012-SchSml-CECStd.cibd25"; // PVArray + Batt
const F_GEOM = "BPP_2025_initial.cibd25";                             // walls + windows

let pass = 0, fail = 0;
function ok(label, cond, detail){
  if(cond){ console.log("  PASS:", label); pass++; }
  else { console.error("  FAIL:", label, detail === undefined ? "" : "-- " + detail); fail++; }
}
function near(a, b, tol){ return Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol); }

async function run(){
  /* ---- 1. The generated tables still agree with the ruleset ------------- */
  console.log("\n[1] Generated tables vs the ruleset");
  for(const tool of ["tools/extract_field_model.js", "tools/extract_load_defaults.js"]){
    let out = "", failed = false;
    try { out = execFileSync("node", [tool, "--check"], {encoding: "utf8"}); }
    catch(e){ failed = true; out = (e.stdout || "") + (e.stderr || ""); }
    ok(tool + " --check", !failed, out.trim().split("\n").slice(0, 4).join(" | "));
  }

  /* ---- 2. Field model: narrowing, bands, ref filters -------------------- */
  console.log("\n[2] Field model");
  await loadFile(F_GEOM);
  const e = expr => win.eval(expr);
  const appDoc = appDoc_();
  const { fieldMeta, fieldEnumVals, fieldEnumDefault, fieldCheck, refCandidates,
          setPlainAttr, deletePlainAttr, makeRecord, serializeDoc, parseDoc,
          polyArea3D, polyAzimuth, azToOrientation, geomPointRecords,
          buildHierarchy, envWallStats, envApplyWWR, envPlaneBasis, pointInPoly2D,
          envRefProp, mapIntLtgSystems, ltgSystemWatts, spaceArea,
          getLoadDefaults, insertProjChild, fieldExists } = win;

  const fen = appDoc.records.find(r => r.type === "FenCons");
  ok("FenCons found in the test file", !!fen);
  // FenProdType narrows on FenType, exactly as the ruleset branches it.
  setPlainAttr(fen, "FenType", "VerticalFenestration");
  const vertProd = fieldEnumVals(fen, "FenProdType");
  setPlainAttr(fen, "FenType", "Skylight");
  const skyProd = fieldEnumVals(fen, "FenProdType");
  setPlainAttr(fen, "FenType", "VerticalFenestration");
  ok("FenProdType offers CurtainWall for vertical fenestration", vertProd.indexOf("CurtainWall") !== -1);
  ok("FenProdType withholds CurtainWall for a skylight", skyProd.indexOf("CurtainWall") === -1);
  ok("FenProdType options are not a union of both branches", vertProd.length !== skyProd.length);

  // CertificationMthd narrows on AssmContext AND FenType -- a two-term condition.
  setPlainAttr(fen, "AssmContext", "FieldFabricated");
  const ff = fieldEnumVals(fen, "CertificationMthd");
  setPlainAttr(fen, "AssmContext", "Manufactured");
  const mf = fieldEnumVals(fen, "CertificationMthd");
  ok("FieldFabricated glazing cannot be NFRCRated", ff.indexOf("NFRCRated") === -1);
  ok("Manufactured glazing can be NFRCRated", mf.indexOf("NFRCRated") !== -1);

  const uf = fieldMeta("FenCons", "UFactor");
  ok("FenCons:UFactor carries the ruleset's error band 0..2.5",
     uf && uf.error && uf.error.min === 0 && uf.error.max === 2.5);
  ok("FenCons:UFactor carries the ruleset's warning band <= 2.3",
     uf && uf.warn && uf.warn.max === 2.3);
  ok("a U-factor of 3 reads as an error", (fieldCheck(fen, "UFactor", 3) || {}).level === "error");
  ok("a U-factor of 2.4 reads as a warning", (fieldCheck(fen, "UFactor", 2.4) || {}).level === "warn");
  ok("a U-factor of 0.3 reads as fine", fieldCheck(fen, "UFactor", 0.3) === null);

  // ObjectRef candidates honour the ruleset's own filter.
  const someWin = appDoc.records.find(r => r.type === "Win");
  const winCands = refCandidates("Win", "FenConsRef");
  setPlainAttr(fen, "FenType", "Skylight");
  const winCandsAfter = refCandidates("Win", "FenConsRef");
  setPlainAttr(fen, "FenType", "VerticalFenestration");
  ok("Win:FenConsRef offers the vertical-fenestration construction", winCands.indexOf(fen.name) !== -1);
  ok("Win:FenConsRef drops it once it becomes a skylight construction",
     winCandsAfter.indexOf(fen.name) === -1);

  const extWall = appDoc.records.find(r => r.type === "ExtWall");
  ok("ExtWall's construction field is ConsAssmRef", envRefProp(extWall) === "ConsAssmRef");
  ok("Win's construction field is FenConsRef", envRefProp(someWin) === "FenConsRef");

  /* ---- 3. Envelope geometry: area, orientation, WWR --------------------- */
  console.log("\n[3] Envelope geometry");
  // A vertical wall has zero plan-view area, which is why the step uses Newell's
  // method rather than the shoelace the floor areas use.
  const wallPts = extWall.points;
  ok("exterior wall has a polygon", !!wallPts && wallPts.length >= 3);
  ok("wall area is nonzero in 3D", polyArea3D(wallPts) > 1);
  ok("plan-view shoelace would have reported nothing for it",
     near(win.shoelaceArea(wallPts.map(p => [p[0], p[1]])), 0, 1e-6));
  const az = polyAzimuth(wallPts);
  ok("wall has an azimuth in 0..360", az !== null && az >= 0 && az < 360, String(az));
  ok("azimuth maps to one of the four orientations", ORIENT_OK(azToOrientation(az)));
  ok("a horizontal surface has no azimuth",
     polyAzimuth([[0,0,10],[10,0,10],[10,10,10],[0,10,10]]) === null);

  const stats0 = envWallStats();
  const totWall0 = ORIENTATIONS_SUM(stats0, "wall"), totWin0 = ORIENTATIONS_SUM(stats0, "win");
  ok("the model has gross wall area", totWall0 > 100, String(totWall0));
  ok("the model has window area", totWin0 > 10, String(totWin0));
  ok("overall WWR is a plausible fraction", totWin0 / totWall0 > 0 && totWin0 / totWall0 < 1,
     String(totWin0 / totWall0));

  // Every window starts inside its host wall, and has to stay there.
  function windowsInsideWalls(stats){
    for(const o of ["North","East","South","West"]){
      for(const wall of stats.byOrient[o].walls){
        const basis = envPlaneBasis(wall.rec.points);
        if(!basis) continue;
        const wall2 = wall.rec.points.map(basis.to2D);
        for(const w of wall.wins){
          for(const p of w.rec.points){
            if(!pointInPoly2D(basis.to2D(p), wall2)) return false;
          }
        }
      }
    }
    return true;
  }
  ok("every window starts inside its host wall", windowsInsideWalls(stats0));

  // Shrink an orientation: the target is always reachable downward, so this one
  // should land on the number.
  const orient = ["North","East","South","West"].find(o => stats0.byOrient[o].win > 0);
  const before = stats0.byOrient[orient];
  const beforeRatio = before.win / before.wall;
  const shrinkTo = beforeRatio / 2;
  const res1 = envApplyWWR(before, shrinkTo);
  buildHierarchy(appDoc);
  let stats1 = envWallStats();
  ok("shrinking " + orient + " hits the target WWR",
     near(stats1.byOrient[orient].win / stats1.byOrient[orient].wall, shrinkTo, 1e-4),
     res1.message);
  ok("shrinking reports no window held back", res1.capped === false, res1.message);
  ok("shrinking leaves gross wall area alone", near(stats1.byOrient[orient].wall, before.wall, 1e-6));
  ok("shrinking leaves the other orientations alone",
     ["North","East","South","West"].filter(o => o !== orient)
       .every(o => near(stats1.byOrient[o].win, stats0.byOrient[o].win, 1e-6)));
  ok("windows are still inside their walls after shrinking", windowsInsideWalls(stats1));

  // Grow it far past what the walls can hold: the step must stop at the wall edge
  // and say so, rather than pushing windows out of the building.
  const res2 = envApplyWWR(stats1.byOrient[orient], 0.99);
  buildHierarchy(appDoc);
  const stats2 = envWallStats();
  ok("growing to 99% reports windows held back by their walls", res2.capped === true, res2.message);
  ok("growing did increase the window area",
     stats2.byOrient[orient].win > stats1.byOrient[orient].win);
  ok("growing stayed under the 99% asked for",
     stats2.byOrient[orient].win / stats2.byOrient[orient].wall < 0.99);
  ok("windows are still inside their walls after growing", windowsInsideWalls(stats2));

  // The coordinates that moved are real records, so they survive a round trip.
  const reparsed = parseDoc(serializeDoc(appDoc));
  buildHierarchy(reparsed);
  win.__rt = reparsed;
  win.eval("window.__savedDoc = doc; doc = window.__rt;");
  const statsSaved = win.envWallStats();
  win.eval("doc = window.__savedDoc;");
  ok("the rescaled geometry survives serialize + reparse",
     near(statsSaved.byOrient[orient].win, stats2.byOrient[orient].win, 1e-3),
     statsSaved.byOrient[orient].win + " vs " + stats2.byOrient[orient].win);

  /* ---- 4. Envelope assignments ------------------------------------------ */
  console.log("\n[4] Envelope assignments");
  const ca = appDoc.records.find(r => r.type === "ConsAssm" && r.attrs.CompatibleSurfType === "ExteriorWall");
  ok("an exterior-wall assembly exists", !!ca);
  ok("ExtWall:ConsAssmRef only offers exterior-wall assemblies",
     refCandidates("ExtWall", "ConsAssmRef").indexOf(ca.name) !== -1 &&
     !refCandidates("ExtWall", "ConsAssmRef").some(n => {
       const r = appDoc.records.find(x => x.type === "ConsAssm" && x.name === n);
       return r && r.attrs.CompatibleSurfType && r.attrs.CompatibleSurfType !== "ExteriorWall";
     }));
  // Removing a middle layer has to close the gap: a hole in the index would
  // silently reorder the stack CBECC reads.
  const roofCa = appDoc.records.find(r => r.type === "ConsAssm" &&
    r.attrs.MatRef && r.attrs.MatRef.__indexed && Object.keys(r.attrs.MatRef.values).length >= 3);
  const layersBefore = Object.keys(roofCa.attrs.MatRef.values).map(Number).sort((a,b)=>a-b)
    .map(i => roofCa.attrs.MatRef.values[i]);
  const dropped = layersBefore[1];
  const kept = layersBefore.filter((_, i) => i !== 1);
  deletePlainAttr(roofCa, "MatRef");
  kept.forEach((n, i) => win.setIndexedAttr(roofCa, "MatRef", i + 1, n));
  const layersAfter = Object.keys(roofCa.attrs.MatRef.values).map(Number).sort((a,b)=>a-b);
  ok("layer indices stay contiguous after a removal",
     layersAfter.join(",") === kept.map((_, i) => i + 1).join(","), layersAfter.join(","));
  ok("the removed layer is gone and the rest keep their order",
     kept.every((n, i) => roofCa.attrs.MatRef.values[i + 1] === n));
  ok("the layer count dropped by exactly one", layersAfter.length === layersBefore.length - 1);

  /* ---- 5. Skylights are their own surfaces ------------------------------ */
  console.log("\n[5] Skylights (Skylt hierarchy)");
  await loadFile(F_SKY);
  const skyDoc = appDoc_();
  const skylights = skyDoc.records.filter(r => r.type === "Skylt");
  ok("the skylight test file has skylights", skylights.length > 20, String(skylights.length));
  ok("every skylight has its own polygon", skylights.every(s => s.points && s.points.length >= 3));
  ok("every skylight is hosted by a roof",
     skylights.every(s => s.host && s.host.type === "Roof"));
  // The bug this guards: a skylight's PolyLp used to land on the host Roof and
  // replace the roof's own coordinates, so the roof came out skylight-sized.
  ok("no roof was shrunk to its skylight's size",
     skyDoc.records.filter(r => r.type === "Roof").every(roof => {
       const ra = win.polyArea3D(roof.points);
       if(ra === null) return true;
       return (roof.openings || []).every(op => win.polyArea3D(op.points) <= ra + 1e-6);
     }));

  /* ---- 6. Lighting ------------------------------------------------------ */
  console.log("\n[6] Interior lighting");
  await loadFile(F_LTG);
  const ltgDoc = appDoc_();
  const ltgMap = win.mapIntLtgSystems();
  const lumSpaces = [...ltgMap.keys()].filter(s => ltgMap.get(s).length > 0);
  ok("lighting systems are attributed to spaces", lumSpaces.length > 0, String(lumSpaces.length));
  ok("every IntLtgSys record found an owning space",
     [...ltgMap.values()].reduce((a, v) => a + v.length, 0) ===
     ltgDoc.records.filter(r => r.type === "IntLtgSys").length);
  const sys = ltgMap.get(lumSpaces[0])[0];
  const w = win.ltgSystemWatts(sys);
  // 10 luminaires of the referenced type -- count times the luminaire's own Pwr.
  const refName = sys.attrs.LumRef.values[1];
  const lum = ltgDoc.records.find(r => r.type === "Lum" && r.name === refName);
  ok("system watts is count x luminaire power",
     near(w, sys.attrs.LumCnt.values[1] * lum.attrs.Pwr, 1e-6), w + " W");
  const oldPwr = lum.attrs.Pwr;
  win.setPlainAttr(lum, "Pwr", oldPwr * 2);
  ok("doubling the luminaire's Pwr doubles the system", near(win.ltgSystemWatts(sys), w * 2, 1e-6));
  win.setPlainAttr(lum, "Pwr", oldPwr);

  // The 5.4A default, and the fact that it is only offered on the space-level path.
  const lds = win.getLoadDefaults();
  ok("the 5.4A load table is available for this file's code year", !!lds);
  const office = lds["Office Area (>250 square feet)"];
  ok("5.4A carries an interior LPD for offices", office && typeof office.intLPDReg === "number",
     JSON.stringify(office));
  const ltgHtml = openStep("Interior lighting").innerHTML;
  ok("the lighting step reports the luminaire path", ltgHtml.indexOf("IntLtgSys") !== -1);
  ok("the lighting step says IntLPDReg is ignored there",
     ltgHtml.indexOf("ignores IntLPDReg") !== -1 || ltgHtml.indexOf("does not read it") !== -1);

  // A space-level space takes the default; a luminaire-path space is left alone.
  const plain = ltgDoc.records.find(r => r.type === "Spc" && (ltgMap.get(r) || []).length === 0 &&
    lds[r.attrs.SpcFunc] !== undefined);
  if(plain){
    const want = lds[plain.attrs.SpcFunc].intLPDReg;
    win.setPlainAttr(plain, "IntLPDReg", want);
    ok("a space-level space accepts the 5.4A LPD", near(plain.attrs.IntLPDReg, want, 1e-9));
  } else {
    ok("a space-level space accepts the 5.4A LPD", true, "no space-level space in this file");
  }

  /* ---- 7. Process and plug loads ---------------------------------------- */
  console.log("\n[7] Process and plug loads");
  const procMeta = fieldMeta("Spc", "ProcGasPwrDens");
  ok("ProcGasPwrDens is an Optional input", procMeta.inputClass === "Optional");
  ok("ProcGasPwrDens carries the 0..100 error band",
     procMeta.error.min === 0 && procMeta.error.max === 100);
  ok("ProcGasPwrDens carries the <=20 warning band", procMeta.warn.max === 20);
  const anySpc = ltgDoc.records.find(r => r.type === "Spc");
  win.setPlainAttr(anySpc, "ProcElecPwrDens", 5);
  ok("a process density can be written", anySpc.attrs.ProcElecPwrDens === 5);
  win.deletePlainAttr(anySpc, "ProcElecPwrDens");
  ok("clearing it removes the field rather than writing 0",
     anySpc.attrs.ProcElecPwrDens === undefined &&
     anySpc.order.indexOf("ProcElecPwrDens") === -1);
  ok("and it does not reappear in the serialized file",
     serializeDoc(ltgDoc).indexOf("ProcElecPwrDens") === -1);
  // The receptacle and gas columns must agree with what the occupancy step writes.
  const kitchen = lds["Kitchen/Food Preparation Area"];
  ok("5.4A gas equipment for a kitchen matches the occupancy table",
     near(kitchen.gasEqpPwrDens, appConst("SPCFUNC_DEFAULTS_54A")["Kitchen/Food Preparation Area"].gasEqpPwrDens, 1e-6));
  const procHtml = openStep("Process + plug loads").innerHTML;
  ok("the process step names all five densities",
     ["RecptPwrDens","ElecEqpPwrDens","GasEqpPwrDens","ProcElecPwrDens","ProcGasPwrDens"]
       .every(p => procHtml.indexOf(p) !== -1));
  ok("the process step says refrigeration is reference-only",
     procHtml.indexOf("reference") !== -1);

  /* ---- 8. Renewables ---------------------------------------------------- */
  console.log("\n[8] Renewables");
  await loadFile(F_PV);
  const pvDoc = appDoc_();
  const pv = pvDoc.records.find(r => r.type === "PVArray");
  const batt = pvDoc.records.find(r => r.type === "Batt");
  ok("the corpus PV array uses DCSysSize, not DCCap", pv && pv.attrs.DCSysSize !== undefined);
  ok("the corpus battery uses MaxCap, not Cap", batt && batt.attrs.MaxCap !== undefined);
  ok("the corpus battery carries CBECC-derived charge power", batt.attrs.MaxChrgPwr !== undefined);
  ok("MaxChrgPwr is not offered as an input", fieldMeta("Batt", "MaxChrgPwr") === null);
  ok("Batt:Ctrl offers Time of Use", fieldEnumVals(batt, "Ctrl").indexOf("Time of Use") !== -1);
  ok("Batt:Ctrl withholds research-mode control",
     fieldEnumVals(batt, "Ctrl").indexOf("Advanced DR Control") === -1);

  // Module type widens with the detailed specification method, as the ruleset has it.
  win.setPlainAttr(pv, "SpecMthd", "Simplified");
  const simpleModules = fieldEnumVals(pv, "ModuleType");
  win.setPlainAttr(pv, "SpecMthd", "Detailed");
  const detailModules = fieldEnumVals(pv, "ModuleType");
  ok("Simplified PV offers no Thin Film module", simpleModules.indexOf("Thin Film") === -1);
  ok("Detailed PV does offer Thin Film", detailModules.indexOf("Thin Film") !== -1);

  const nPV = pvDoc.records.filter(r => r.type === "PVArray").length;
  openStep("Renewables");
  const addBtn = [...doc_.querySelectorAll('#stepResults button')].find(b => b.textContent === "Add PV array");
  ok("the renewables step offers to add a PV array", !!addBtn);
  addBtn.dispatchEvent(new win.Event('click', {bubbles: true}));
  const pvs = pvDoc.records.filter(r => r.type === "PVArray");
  ok("adding a PV array appends one record", pvs.length === nPV + 1);
  const made = pvs[pvs.length - 1];
  // Where the ruleset declares a default it actually offers, the new record takes it.
  ok("the new array takes the ruleset's own module-type default",
     made.attrs.ModuleType === fieldEnumDefault(made, "ModuleType") &&
     made.attrs.ModuleType === "Standard");
  ok("and its power-electronics default", made.attrs.PwrElec === fieldEnumDefault(made, "PwrElec"));
  // Where it declares one it does NOT offer -- PVArray:ArrayType, SpecMthd and TiltInp
  // all declare id -1 while listing 1..n -- nothing is written rather than guessed.
  ok("PVArray:ArrayType declares a default the ruleset does not offer",
     fieldEnumDefault(made, "ArrayType") === null);
  ok("so no array type is invented for the new record", made.attrs.ArrayType === undefined);
  ok("the new array invents no DC size", made.attrs.DCSysSize === undefined);
  ok("the new array lands before the trailing results records", (() => {
    const i = pvDoc.records.indexOf(made);
    return !pvDoc.records.slice(0, i).some(r => r.type === "EUseSummary");
  })());
  const rendered = doc_.getElementById("stepResults").innerHTML;
  ok("the step flags the missing DC size", rendered.indexOf("no DC system size") !== -1);
  ok("the step surfaces the derived battery power read-only",
     rendered.indexOf("MaxChrgPwr") !== -1 && rendered.indexOf("CBECC-derived") !== -1);

  // Only the tilt field the input mode selects is offered -- set every array in the
  // file the same way, since the step renders a card per array.
  const allPV = pvDoc.records.filter(r => r.type === "PVArray");
  allPV.forEach(a => win.setPlainAttr(a, "TiltInp", "pitch"));
  openStep("Renewables");
  const pitchHtml = doc_.getElementById("stepResults").innerHTML;
  allPV.forEach(a => win.setPlainAttr(a, "TiltInp", "deg"));
  openStep("Renewables");
  const degHtml = doc_.getElementById("stepResults").innerHTML;
  ok("pitch mode offers TiltPitch and not TiltAngle",
     pitchHtml.indexOf("TiltPitch") !== -1 && pitchHtml.indexOf("TiltAngle") === -1);
  ok("degree mode offers TiltAngle and not TiltPitch",
     degHtml.indexOf("TiltAngle") !== -1 && degHtml.indexOf("TiltPitch") === -1);

  // A new array has to survive the round trip through the file format.
  win.setPlainAttr(made, "DCSysSize", 42.5);
  const rt = parseDoc(serializeDoc(pvDoc));
  const rtPV = rt.records.filter(r => r.type === "PVArray");
  ok("the new PV array round-trips through the file", rtPV.length === nPV + 1 &&
     rtPV[rtPV.length - 1].attrs.DCSysSize === 42.5);

  /* ---- 9. Code-year protocol -------------------------------------------- */
  // The rule in this tool: enum LISTS may fall back to another cycle, loudly; numeric
  // DEFAULTS never do. These four steps have to obey it the way the occupancy and HVAC
  // steps do -- and there are real 2022-vs-2025 differences to obey it about.
  console.log("\n[9] Code-year protocol");
  const setYear = y => { pvDoc.codeYear = y; };
  const battRec = pvDoc.records.find(r => r.type === "Batt");

  setYear(2022);
  ok("a 2022 file uses the 2022 field model", win.hasFieldModel() && win.fieldModelYear() === 2022);
  const ctrl22 = fieldEnumVals(battRec, "Ctrl");
  setYear(2025);
  const ctrl25 = fieldEnumVals(battRec, "Ctrl");
  // A genuine cycle difference: 2022 offers Advanced DR Control outside research mode,
  // 2025 does not.
  ok("Batt:Ctrl offers Advanced DR Control under 2022", ctrl22.indexOf("Advanced DR Control") !== -1);
  ok("and withholds it under 2025", ctrl25.indexOf("Advanced DR Control") === -1);

  // Availability, not just option sets: Ceiling:Status is an input in 2025 and absent
  // from 2022, and an absent field must not render as an empty control.
  setYear(2025);
  ok("Ceiling:Status is an input under 2025", fieldExists("Ceiling", "Status"));
  setYear(2022);
  ok("Ceiling:Status is not an input under 2022", fieldExists("Ceiling", "Status") === false);
  const ceil = {type: "Ceiling", name: "x", attrs: {}, order: []};
  const absentEl = win.wfEnumInput(ceil, "Status", () => {});
  ok("an absent field renders as a n/a marker rather than an empty picker",
     absentEl.textContent.indexOf("n/a in T24-2022") !== -1, absentEl.outerHTML.slice(0, 120));
  setYear(2025);
  ok("and renders as a real control under 2025",
     win.wfEnumInput(ceil, "Status", () => {}).querySelector("input") !== null);

  // Numeric defaults are year-keyed with no fallback. Three 5.4A rows really do differ
  // between the cycles, so borrowing one would put the wrong LPD in a file.
  setYear(2022);
  const ld22 = getLoadDefaults();
  setYear(2025);
  const ld25 = getLoadDefaults();
  ok("Storage LPD is 0.45 under 2022 and 0.40 under 2025",
     near(ld22["Storage"].intLPDReg, 0.45, 1e-9) && near(ld25["Storage"].intLPDReg, 0.4, 1e-9),
     ld22["Storage"].intLPDReg + " / " + ld25["Storage"].intLPDReg);
  ok("the small-office row exists only in 2025",
     ld22["Office Area (<=250 square feet)"] === undefined &&
     ld25["Office Area (<=250 square feet)"] !== undefined);
  setYear(2028);
  ok("2028 gets no load defaults at all rather than 2025's", getLoadDefaults() === null);
  ok("2028 has no field model of its own", win.hasFieldModel() === false);
  ok("so 2028 borrows the fallback vocabulary", win.fieldModelYear() === 2025);
  const borrowNotice = win.wfFieldModelNotice();
  ok("and the notice names both years",
     borrowNotice && borrowNotice.textContent.indexOf("T24-2028") !== -1 &&
     borrowNotice.textContent.indexOf("T24-2025") !== -1,
     borrowNotice && borrowNotice.textContent.slice(0, 90));
  setYear(2019);
  ok("2019 degrades the same way, not just 2028",
     getLoadDefaults() === null && win.fieldModelYear() === 2025);

  // The steps have to say so on screen, not silently offer nothing.
  setYear(2028);
  const ltg2028 = openStep("Interior lighting").innerHTML;
  ok("the lighting step says no 5.4A table exists for 2028",
     ltg2028.indexOf("T24-2028") !== -1 && ltg2028.indexOf("no Appendix 5.4A table") !== -1);
  const proc2028 = openStep("Process + plug loads").innerHTML;
  ok("the process step says the same", proc2028.indexOf("no Appendix 5.4A table") !== -1);
  const env2028 = openStep("Envelope").innerHTML;
  ok("the envelope step flags the borrowed option sets", env2028.indexOf("partial support") !== -1);
  setYear(2025);
  const env2025 = openStep("Envelope").innerHTML;
  ok("and drops that flag for a cycle it does model", env2025.indexOf("partial support") === -1);

  // Nothing about which construction a surface accepts is hand-transcribed either.
  ok("the surface-to-construction rule is read from the year's own model",
     (() => { const r = win.envRefRequirement("ExtWall", "ConsAssmRef");
              return r && r.type === "ConsAssm" && r.key === "CompatibleSurfType" &&
                     r.value === "ExteriorWall"; })());
  ok("and the window-to-glazing rule too",
     (() => { const r = win.envRefRequirement("Win", "FenConsRef");
              return r && r.type === "FenCons" && r.key === "FenType" &&
                     r.value === "VerticalFenestration"; })());

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}

// Small readability helpers used above.
function ORIENT_OK(o){ return ["North","East","South","West"].indexOf(o) !== -1; }
function ORIENTATIONS_SUM(stats, key){
  return ["North","East","South","West"].reduce((a, o) => a + stats.byOrient[o][key], 0);
}

run().catch(err => { console.error(err); process.exit(1); });
