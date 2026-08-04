// Test: new HVAC system types added in Stage 6
// Covers buildSystemComponents for FPFC, WSHP, PTAC, PTHP, MiniSplitHP, MiniSplitAC,
// Furnace, Radiant, Baseboard, PassiveBeam, EvaporativeCooler, HV.
// Also tests HV zone-assignment/removal and WSHP fluid loop wiring.

const { dom, win, doc_, loadFile } = require('./run_full.js');

const testFile = "C:/Users/CharlieChristenson/OneDrive - Stok LLC/Documents/CBECC 2025 Projects/StandardModelTests/040012-OffLrg-CECStd.cibd25";

async function run(){
  let pass = 0, fail = 0;
  function ok(label, cond){ if(cond){ console.log("  PASS:", label); pass++; } else { console.error("  FAIL:", label); fail++; } }

  await loadFile(testFile);

  const e = (expr) => win.eval(expr);
  const createSystem          = win.createSystem;
  const buildSystemComponents = win.buildSystemComponents;
  const deleteSystem          = win.deleteSystem;
  const assignZoneToHvSys     = win.assignZoneToHvSys;
  const removeZoneFromHvSys   = win.removeZoneFromHvSys;
  const getOrCreateThrmlZn    = win.getOrCreateThrmlZn;
  const createFluidLoop       = win.createFluidLoop;
  const makeRecord            = win.makeRecord;
  const setPlainAttr          = win.setPlainAttr;
  const serializeDoc          = win.serializeDoc;
  const parseDoc              = win.parseDoc;
  const appDoc                = e('doc');

  function childrenOf(sys){
    const HVAC_CHILD_TYPES = e('HVAC_CHILD_TYPES');
    const idx = appDoc.records.indexOf(sys);
    const kids = [];
    let i = idx + 1;
    while(i < appDoc.records.length && HVAC_CHILD_TYPES.has(appDoc.records[i].type)){
      kids.push(appDoc.records[i]); i++;
    }
    return kids;
  }

  // -----------------------------------------------------------------------
  // FPFC: CoilClg(ChilledWater) → CoilHtg(HotWater) → Fan(CV)
  // -----------------------------------------------------------------------
  console.log("\n--- FPFC ---");
  const fpfc = createSystem(appDoc, "FPFC", "TestFPFC");
  buildSystemComponents(appDoc, fpfc);
  fpfc._componentsBuilt = true;
  const fpfcKids = childrenOf(fpfc);
  ok("FPFC has 3 children", fpfcKids.length === 3);
  ok("FPFC child[0] = CoilClg",            fpfcKids[0] && fpfcKids[0].type === "CoilClg");
  ok("FPFC CoilClg.Type = ChilledWater",   fpfcKids[0] && fpfcKids[0].attrs.Type === "ChilledWater");
  ok("FPFC child[1] = CoilHtg",            fpfcKids[1] && fpfcKids[1].type === "CoilHtg");
  ok("FPFC CoilHtg.Type = HotWater",       fpfcKids[1] && fpfcKids[1].attrs.Type === "HotWater");
  ok("FPFC child[2] = Fan",                fpfcKids[2] && fpfcKids[2].type === "Fan");
  ok("FPFC Fan.CtrlMthd = ConstantVolume", fpfcKids[2] && fpfcKids[2].attrs.CtrlMthd === "ConstantVolume");

  // -----------------------------------------------------------------------
  // WSHP: CoilClg(DX, WaterSource) → CoilHtg(HP, WaterSource) → Fan(CV)
  // -----------------------------------------------------------------------
  console.log("\n--- WSHP ---");
  const wshp = createSystem(appDoc, "WSHP", "TestWSHP");
  buildSystemComponents(appDoc, wshp);
  wshp._componentsBuilt = true;
  const wshpKids = childrenOf(wshp);
  ok("WSHP has 3 children", wshpKids.length === 3);
  ok("WSHP CoilClg.Type = DirectExpansion",  wshpKids[0] && wshpKids[0].attrs.Type === "DirectExpansion");
  ok("WSHP CoilClg.CndsrType = WaterSource", wshpKids[0] && wshpKids[0].attrs.CndsrType === "WaterSource");
  ok("WSHP CoilHtg.Type = HeatPump",         wshpKids[1] && wshpKids[1].attrs.Type === "HeatPump");
  ok("WSHP CoilHtg.CndsrType = WaterSource", wshpKids[1] && wshpKids[1].attrs.CndsrType === "WaterSource");
  // Create a new CW loop; WSHP coils should be wired to it (either auto-wired at creation
  // if a CW loop already existed in the corpus, or newly wired when this loop is created)
  const cwLoop = createFluidLoop(appDoc, "CondenserWater", "TestCW", {});
  const cwSupSeg = appDoc.records.find(r => r.type === "FluidSeg" && r.name === "TestCW PrimSupSeg");
  ok("TestCW FluidSeg created",                   !!cwSupSeg);
  ok("WSHP CoilClg is wired (to some CW loop)",   !!wshpKids[0].attrs.FluidSegInRef);
  ok("WSHP CoilHtg is wired (to some CW loop)",   !!wshpKids[1].attrs.FluidSegInRef);
  ok("WSHP CoilClg and CoilHtg share same FluidSegInRef", wshpKids[0].attrs.FluidSegInRef === wshpKids[1].attrs.FluidSegInRef);

  // -----------------------------------------------------------------------
  // PTAC: CoilHtg(Resistance) → CoilClg(DX) → Fan(CV)
  // -----------------------------------------------------------------------
  console.log("\n--- PTAC ---");
  const ptac = createSystem(appDoc, "PTAC", "TestPTAC");
  buildSystemComponents(appDoc, ptac);
  const ptacKids = childrenOf(ptac);
  ok("PTAC has 3 children",                ptacKids.length === 3);
  ok("PTAC child[0] = CoilHtg (first)",    ptacKids[0] && ptacKids[0].type === "CoilHtg");
  ok("PTAC CoilHtg.Type = Resistance",     ptacKids[0] && ptacKids[0].attrs.Type === "Resistance");
  ok("PTAC child[1] = CoilClg",            ptacKids[1] && ptacKids[1].type === "CoilClg");
  ok("PTAC CoilClg.Type = DirectExpansion",ptacKids[1] && ptacKids[1].attrs.Type === "DirectExpansion");
  ok("PTAC child[2] = Fan",               ptacKids[2] && ptacKids[2].type === "Fan");

  // -----------------------------------------------------------------------
  // PTHP: CoilHtg(HeatPump) → CoilClg(DX) → Fan(TwoSpeed)
  // -----------------------------------------------------------------------
  console.log("\n--- PTHP ---");
  const pthp = createSystem(appDoc, "PTHP", "TestPTHP");
  buildSystemComponents(appDoc, pthp);
  const pthpKids = childrenOf(pthp);
  ok("PTHP has 3 children",               pthpKids.length === 3);
  ok("PTHP CoilHtg.Type = HeatPump",      pthpKids[0] && pthpKids[0].attrs.Type === "HeatPump");
  ok("PTHP CoilClg.Type = DirectExpansion", pthpKids[1] && pthpKids[1].attrs.Type === "DirectExpansion");
  ok("PTHP Fan.CtrlMthd = TwoSpeed",      pthpKids[2] && pthpKids[2].attrs.CtrlMthd === "TwoSpeed");

  // -----------------------------------------------------------------------
  // MiniSplitHP: CoilClg(DX) → CoilHtg(HeatPump) → Fan(CV)
  // -----------------------------------------------------------------------
  console.log("\n--- MiniSplitHP ---");
  const mshp = createSystem(appDoc, "MiniSplitHP", "TestMSHP");
  buildSystemComponents(appDoc, mshp);
  const mshpKids = childrenOf(mshp);
  ok("MiniSplitHP has 3 children",              mshpKids.length === 3);
  ok("MiniSplitHP CoilClg.Type = DirectExpansion", mshpKids[0] && mshpKids[0].attrs.Type === "DirectExpansion");
  ok("MiniSplitHP CoilHtg.Type = HeatPump",     mshpKids[1] && mshpKids[1].attrs.Type === "HeatPump");
  ok("MiniSplitHP Fan.CtrlMthd = ConstantVolume", mshpKids[2] && mshpKids[2].attrs.CtrlMthd === "ConstantVolume");

  // -----------------------------------------------------------------------
  // MiniSplitAC: CoilClg(DX) → CoilHtg(Resistance) → Fan(CV)
  // -----------------------------------------------------------------------
  console.log("\n--- MiniSplitAC ---");
  const msac = createSystem(appDoc, "MiniSplitAC", "TestMSAC");
  buildSystemComponents(appDoc, msac);
  const msacKids = childrenOf(msac);
  ok("MiniSplitAC has 3 children",               msacKids.length === 3);
  ok("MiniSplitAC CoilClg.Type = DirectExpansion", msacKids[0] && msacKids[0].attrs.Type === "DirectExpansion");
  ok("MiniSplitAC CoilHtg.Type = Resistance",    msacKids[1] && msacKids[1].attrs.Type === "Resistance");

  // -----------------------------------------------------------------------
  // Furnace (ZnSys): CoilHtg(Furnace) only, no CoilClg, no Fan
  // -----------------------------------------------------------------------
  console.log("\n--- Furnace ---");
  const furnace = createSystem(appDoc, "Furnace", "TestFurnace");
  buildSystemComponents(appDoc, furnace);
  const furnaceKids = childrenOf(furnace);
  ok("Furnace has 1 child",               furnaceKids.length === 1);
  ok("Furnace child = CoilHtg",           furnaceKids[0] && furnaceKids[0].type === "CoilHtg");
  ok("Furnace CoilHtg.Type = Furnace",    furnaceKids[0] && furnaceKids[0].attrs.Type === "Furnace");

  // -----------------------------------------------------------------------
  // EvaporativeCooler: no children at all
  // -----------------------------------------------------------------------
  console.log("\n--- EvaporativeCooler ---");
  const evap = createSystem(appDoc, "EvaporativeCooler", "TestEvap");
  buildSystemComponents(appDoc, evap);
  const evapKids = childrenOf(evap);
  ok("EvaporativeCooler has no children", evapKids.length === 0);

  // -----------------------------------------------------------------------
  // Radiant: CoilClg(ChilledWater) → CoilHtg(HotWater), no Fan
  // -----------------------------------------------------------------------
  console.log("\n--- Radiant ---");
  const radiant = createSystem(appDoc, "Radiant", "TestRadiant");
  buildSystemComponents(appDoc, radiant);
  const radiantKids = childrenOf(radiant);
  ok("Radiant has 2 children (no fan)",    radiantKids.length === 2);
  ok("Radiant CoilClg.Type = ChilledWater", radiantKids[0] && radiantKids[0].attrs.Type === "ChilledWater");
  ok("Radiant CoilHtg.Type = HotWater",    radiantKids[1] && radiantKids[1].attrs.Type === "HotWater");

  // -----------------------------------------------------------------------
  // Baseboard: CoilHtg(HotWater) only
  // -----------------------------------------------------------------------
  console.log("\n--- Baseboard ---");
  const bb = createSystem(appDoc, "Baseboard", "TestBB");
  buildSystemComponents(appDoc, bb);
  const bbKids = childrenOf(bb);
  ok("Baseboard has 1 child",              bbKids.length === 1);
  ok("Baseboard CoilHtg.Type = HotWater", bbKids[0] && bbKids[0].attrs.Type === "HotWater");

  // -----------------------------------------------------------------------
  // PassiveBeam: CoilClg(ChilledWater) only
  // -----------------------------------------------------------------------
  console.log("\n--- PassiveBeam ---");
  const pb = createSystem(appDoc, "PassiveBeam", "TestPB");
  buildSystemComponents(appDoc, pb);
  const pbKids = childrenOf(pb);
  ok("PassiveBeam has 1 child",              pbKids.length === 1);
  ok("PassiveBeam CoilClg.Type = ChilledWater", pbKids[0] && pbKids[0].attrs.Type === "ChilledWater");

  // -----------------------------------------------------------------------
  // Fluid loop auto-wire: create CHW + HW loops, then check FPFC/Radiant/Baseboard/PassiveBeam
  // -----------------------------------------------------------------------
  console.log("\n--- Fluid auto-wire after loop creation ---");
  const chWLoop = createFluidLoop(appDoc, "ChilledWater", "TestCHW", {cndsrType: "Air"});
  const hwLoop  = createFluidLoop(appDoc, "HotWater", "TestHW", {});
  // FPFC, Radiant, PassiveBeam should now be wired
  ok("FPFC CoilClg wired to CHW",      !!fpfcKids[0].attrs.FluidSegInRef);
  ok("FPFC CoilHtg wired to HW",       !!fpfcKids[1].attrs.FluidSegInRef);
  ok("Radiant CoilClg wired to CHW",   !!radiantKids[0].attrs.FluidSegInRef);
  ok("Radiant CoilHtg wired to HW",    !!radiantKids[1].attrs.FluidSegInRef);
  ok("Baseboard CoilHtg wired to HW",  !!bbKids[0].attrs.FluidSegInRef);
  ok("PassiveBeam CoilClg wired to CHW", !!pbKids[0].attrs.FluidSegInRef);

  // -----------------------------------------------------------------------
  // HV (AirSys): SupAirSeg → CoilHtg(Furnace) → Fan → RetAirSeg → OACtrl
  //              + TrmlUnit(Uncontrolled) per zone via assignZoneToHvSys
  // -----------------------------------------------------------------------
  console.log("\n--- HV ---");
  const hv = createSystem(appDoc, "HV", "TestHV");
  buildSystemComponents(appDoc, hv);
  hv._componentsBuilt = true;
  const hvKids = childrenOf(hv);
  ok("HV has 5 trunk children",            hvKids.length === 5);
  ok("HV child[0] = AirSeg(Supply)",       hvKids[0] && hvKids[0].type === "AirSeg" && hvKids[0].attrs.Type === "Supply");
  ok("HV child[1] = CoilHtg(Furnace)",     hvKids[1] && hvKids[1].type === "CoilHtg" && hvKids[1].attrs.Type === "Furnace");
  ok("HV child[2] = Fan",                  hvKids[2] && hvKids[2].type === "Fan");
  ok("HV child[3] = AirSeg(Return)",       hvKids[3] && hvKids[3].type === "AirSeg" && hvKids[3].attrs.Type === "Return");
  ok("HV child[4] = OACtrl",               hvKids[4] && hvKids[4].type === "OACtrl");

  const zoneHV1 = getOrCreateThrmlZn(appDoc, "TestHVZone1");
  const zoneHV2 = getOrCreateThrmlZn(appDoc, "TestHVZone2");
  assignZoneToHvSys(appDoc, zoneHV1, hv);
  assignZoneToHvSys(appDoc, zoneHV2, hv);

  const tu1 = appDoc.records.find(r => r.type === "TrmlUnit" && r.attrs.ZnServedRef === "TestHVZone1");
  const tu2 = appDoc.records.find(r => r.type === "TrmlUnit" && r.attrs.ZnServedRef === "TestHVZone2");
  ok("HV TrmlUnit created for zone 1",        !!tu1);
  ok("HV TrmlUnit.Type = Uncontrolled",       tu1 && tu1.attrs.Type === "Uncontrolled");
  ok("HV TrmlUnit.PriAirSegRef = SupAirSeg",  tu1 && tu1.attrs.PriAirSegRef === "TestHV SupAirSeg");
  ok("HV TrmlUnit created for zone 2",        !!tu2);
  ok("OACtrl still trails TrmlUnits",         appDoc.records.indexOf(hvKids[4]) > appDoc.records.indexOf(tu2));

  // removeZoneFromHvSys: zone 1 loses its TrmlUnit
  removeZoneFromHvSys(appDoc, zoneHV1, hv);
  ok("TrmlUnit for zone 1 removed",           !appDoc.records.find(r => r.type === "TrmlUnit" && r.attrs.ZnServedRef === "TestHVZone1"));
  ok("TrmlUnit for zone 2 still present",     !!appDoc.records.find(r => r.type === "TrmlUnit" && r.attrs.ZnServedRef === "TestHVZone2"));

  // deleteSystem: zone 2 ref should be cleared
  deleteSystem(appDoc, hv);
  ok("HV AirSys removed",                     !appDoc.records.find(r => r.type === "AirSys" && r.name === "TestHV"));
  const zone2After = appDoc.records.find(r => r.type === "ThrmlZn" && r.name === "TestHVZone2");
  ok("Zone 2 PriAirCondgSysRef cleared after delete",
    !zone2After || !zone2After.attrs.PriAirCondgSysRef || !zone2After.attrs.PriAirCondgSysRef.__indexed || !zone2After.attrs.PriAirCondgSysRef.values[1]);

  // -----------------------------------------------------------------------
  // Round-trip: serialize and reparse, verify new systems survive
  // -----------------------------------------------------------------------
  console.log("\n--- Round-trip ---");
  const serialized = serializeDoc(appDoc);
  const reparsed   = parseDoc(serialized);
  ok("FPFC survives round-trip",   reparsed.records.some(r => r.type === "ZnSys" && r.name === "TestFPFC"));
  ok("WSHP survives round-trip",   reparsed.records.some(r => r.type === "ZnSys" && r.name === "TestWSHP"));
  ok("PTAC survives round-trip",   reparsed.records.some(r => r.type === "ZnSys" && r.name === "TestPTAC"));
  ok("Furnace survives round-trip", reparsed.records.some(r => r.type === "ZnSys" && r.name === "TestFurnace"));
  ok("Evap survives round-trip",   reparsed.records.some(r => r.type === "ZnSys" && r.name === "TestEvap"));
  ok("Radiant survives round-trip", reparsed.records.some(r => r.type === "ZnSys" && r.name === "TestRadiant"));
  // WSHP coil CndsrType preserved
  const wshpRp = reparsed.records.find(r => r.type === "ZnSys" && r.name === "TestWSHP");
  const wshpIdx = wshpRp ? reparsed.records.indexOf(wshpRp) : -1;
  const wshpClgRp = wshpIdx >= 0 ? reparsed.records.find((r, i) => i > wshpIdx && r.type === "CoilClg") : null;
  ok("WSHP CoilClg.CndsrType preserved", wshpClgRp && wshpClgRp.attrs.CndsrType === "WaterSource");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
