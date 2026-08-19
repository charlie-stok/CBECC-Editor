// Test: exhaust systems (central AirSys + zone-level ZnSys), AirSys:SubType
// (CRAC/CRAH) and the Computer Room advisory, and per-zone DOAS sizing fields.
//
// Ground truth for every assertion here comes from the T24_2025 Input Data Model
// and the reference project corpus:
//   - AirSys:SubType enum + Config-when-CRAC ....... "T24_2025 - Input Data Model.txt"
//   - ThrmlZn:ExhSysRef restricted to Type="Exhaust" ......................... ditto
//   - central exhaust structure ................. OtherTests/OffLrg-PrkgLabKitchen
//   - zone-level exhaust structure .............. OtherTests/OffMed-FanPowerAdj
//   - CRAC/CRAH on real systems ................. OtherTests/OffSml-Data_SZVAV

const { win, loadFile } = require('./run_full.js');

const testFile = "C:/Users/CharlieChristenson/OneDrive - Stok LLC/Documents/CBECC 2025 Projects/StandardModelTests/040012-OffLrg-CECStd.cibd25";

async function run(){
  let pass = 0, fail = 0;
  function ok(label, cond){ if(cond){ console.log("  PASS:", label); pass++; } else { console.error("  FAIL:", label); fail++; } }

  await loadFile(testFile);

  const e = expr => win.eval(expr);
  const appDoc                = e('doc');
  const createSystem          = win.createSystem;
  const buildSystemComponents = win.buildSystemComponents;
  const changeSystemType      = win.changeSystemType;
  const deleteSystem          = win.deleteSystem;
  const assignZoneToExhaustSys= win.assignZoneToExhaustSys;
  const assignZoneToDOAS      = win.assignZoneToDOAS;
  const getOrCreateThrmlZn    = win.getOrCreateThrmlZn;
  const setPlainAttr          = win.setPlainAttr;
  const systemTypeMeta        = win.systemTypeMeta;
  const sysMeta               = win.sysMeta;
  const serializeDoc          = win.serializeDoc;
  const parseDoc              = win.parseDoc;
  const HVAC_CHILD_TYPES      = e('HVAC_CHILD_TYPES');

  function childrenOf(sys){
    const idx = appDoc.records.indexOf(sys);
    const kids = [];
    for(let i = idx + 1; i < appDoc.records.length && HVAC_CHILD_TYPES.has(appDoc.records[i].type); i++){
      kids.push(appDoc.records[i]);
    }
    return kids;
  }

  // ---- 1. Catalog: "Exhaust" now resolves in both families ----------------
  console.log("\n[1] Exhaust type exists in both families");
  ok("systemTypeMeta('Exhaust','AirSys').family is AirSys", systemTypeMeta('Exhaust', 'AirSys').family === 'AirSys');
  ok("systemTypeMeta('Exhaust','ZnSys').family is ZnSys",   systemTypeMeta('Exhaust', 'ZnSys').family === 'ZnSys');
  ok("both are flagged isExhaust",
     systemTypeMeta('Exhaust', 'AirSys').isExhaust && systemTypeMeta('Exhaust', 'ZnSys').isExhaust);
  const hasSubType  = win.hasSubType;
  const subTypesFor = win.subTypesFor;
  ok("HV and Exhaust are excluded from SubType (data model allows only NA)",
     !hasSubType(systemTypeMeta('HV')) && !hasSubType(systemTypeMeta('Exhaust', 'AirSys')));
  ok("SZAC/SZVAVAC/VAV support SubType",
     hasSubType(systemTypeMeta('SZAC')) && hasSubType(systemTypeMeta('SZVAVAC')) &&
     hasSubType(systemTypeMeta('VAV')));

  // ---- 2. Central exhaust (AirSys) ---------------------------------------
  console.log("\n[2] Central exhaust AirSys structure");
  const cx = createSystem(appDoc, 'Exhaust', 'TestCentralExh', 'AirSys');
  buildSystemComponents(appDoc, cx);
  ok("record type is AirSys", cx.type === 'AirSys');
  ok("Type = Exhaust", cx.attrs.Type === 'Exhaust');
  ok("ExhSysType defaults to General", cx.attrs.ExhSysType === 'General');
  ok("ExhCtrlMthd defaults to ConstantFlowConstantSpeedFan",
     cx.attrs.ExhCtrlMthd === 'ConstantFlowConstantSpeedFan');
  const cxKids = childrenOf(cx);
  ok("children are AirSeg + Fan", cxKids.length === 2 && cxKids[0].type === 'AirSeg' && cxKids[1].type === 'Fan');
  ok("AirSeg Type = Exhaust", cxKids[0].attrs.Type === 'Exhaust');
  ok("Fan carries StaticPressure modeling", cxKids[1].attrs.ModelingMthd === 'StaticPressure');

  // ---- 3. Zone-level exhaust fan (ZnSys) ---------------------------------
  console.log("\n[3] Zone-level exhaust ZnSys structure");
  const zx = createSystem(appDoc, 'Exhaust', 'TestZoneExh', 'ZnSys');
  buildSystemComponents(appDoc, zx);
  ok("record type is ZnSys", zx.type === 'ZnSys');
  const zxKids = childrenOf(zx);
  ok("child is a bare Fan, no AirSeg", zxKids.length === 1 && zxKids[0].type === 'Fan');
  ok("sysMeta resolves the ZnSys catalog entry", sysMeta(zx).family === 'ZnSys');

  // ---- 4. Exhaust wires through ExhSysRef, never VentSysRef --------------
  console.log("\n[4] Exhaust wiring field");
  const zoneA = getOrCreateThrmlZn(appDoc, 'TestExhZoneA');
  const zoneB = getOrCreateThrmlZn(appDoc, 'TestExhZoneB');
  assignZoneToExhaustSys(appDoc, zoneA, zx);
  assignZoneToExhaustSys(appDoc, zoneB, zx);
  ok("zone A ExhSysRef set", zoneA.attrs.ExhSysRef === 'TestZoneExh');
  ok("zone A VentSysRef untouched", zoneA.attrs.VentSysRef === undefined);
  ok("one ZnSys exhaust fan serves several zones", zoneB.attrs.ExhSysRef === 'TestZoneExh');
  ok("assignZoneToVentSys helper is gone", typeof win.assignZoneToVentSys === 'undefined');
  ok("mapSpaceToExhaustSystem helper is gone", typeof win.mapSpaceToExhaustSystem === 'undefined');

  // A zone can carry a DOAS assignment and an exhaust assignment at once; changing
  // the exhaust system's type must not clear the unrelated VentSysRef.
  console.log("\n[5] Type change on an exhaust system leaves DOAS wiring alone");
  const doasSys = createSystem(appDoc, 'DOASCV', 'TestDOAS', 'AirSys');
  buildSystemComponents(appDoc, doasSys);
  assignZoneToDOAS(appDoc, zoneA, doasSys);
  ok("zone A now has both refs",
     zoneA.attrs.VentSysRef === 'TestDOAS' && zoneA.attrs.ExhSysRef === 'TestZoneExh');
  changeSystemType(appDoc, zx, 'Exhaust', {family: 'AirSys'});
  ok("exhaust system moved to AirSys family", zx.type === 'AirSys');
  ok("exhaust re-wired on the new family", zoneA.attrs.ExhSysRef === 'TestZoneExh');
  ok("DOAS reference survived the exhaust type change", zoneA.attrs.VentSysRef === 'TestDOAS');

  // ---- 6. SubType / Config lifecycle -------------------------------------
  console.log("\n[6] AirSys:SubType and CRAC Config");
  const crac = createSystem(appDoc, 'SZVAVAC', 'TestCRAC', 'AirSys');
  buildSystemComponents(appDoc, crac);
  setPlainAttr(crac, 'SubType', 'CRAC');
  setPlainAttr(crac, 'Config', 'Floor-Mounted (Downflow)');
  ok("SubType written", crac.attrs.SubType === 'CRAC');
  // HV allows only SubType="NA", so switching to it must drop SubType and Config.
  changeSystemType(appDoc, crac, 'HV', {family: 'AirSys'});
  ok("SubType dropped when the new Type disallows it", crac.attrs.SubType === undefined);
  ok("Config dropped alongside SubType", crac.attrs.Config === undefined);
  changeSystemType(appDoc, crac, 'Exhaust', {family: 'AirSys'});
  ok("exhaust properties appear on the exhaust type", crac.attrs.ExhSysType === 'General');
  changeSystemType(appDoc, crac, 'SZAC', {family: 'AirSys'});
  ok("exhaust properties dropped when leaving Exhaust", crac.attrs.ExhSysType === undefined &&
     crac.attrs.ExhOperMode === undefined && crac.attrs.ExhCtrlMthd === undefined);

  // ---- 7. Computer Room advisory -----------------------------------------
  console.log("\n[7] Computer Room advisory");
  const systemServesComputerRoom = win.systemServesComputerRoom;
  const crZone = getOrCreateThrmlZn(appDoc, 'TestCompRmZone');
  win.assignZoneToSystem(appDoc, crZone, crac);
  const anySpc = appDoc.records.find(r => r.type === 'Spc');
  const savedZn = anySpc.attrs.ThrmlZnRef, savedFn = anySpc.attrs.SpcFunc;
  setPlainAttr(anySpc, 'ThrmlZnRef', 'TestCompRmZone');
  setPlainAttr(anySpc, 'SpcFunc', 'Office');
  ok("no advisory for a non-computer-room space", !systemServesComputerRoom(appDoc, crac));
  setPlainAttr(anySpc, 'SpcFunc', 'Computer Room');
  ok("advisory fires for a Computer Room space", systemServesComputerRoom(appDoc, crac));
  setPlainAttr(anySpc, 'ThrmlZnRef', savedZn === undefined ? '- none -' : savedZn);
  if(savedFn !== undefined) setPlainAttr(anySpc, 'SpcFunc', savedFn);

  // ---- 8. DOAS zone sizing round-trips through the serializer -------------
  console.log("\n[8] DOAS zone sizing fields");
  setPlainAttr(zoneA, 'SizeForDOAS', 1);
  setPlainAttr(zoneA, 'SizeForDOASCtrl', 'NeutralDehumidifed');
  setPlainAttr(zoneA, 'SizeForDOASTempLow', 60);
  setPlainAttr(zoneA, 'SizeForDOASTempHi', 75);
  const round = parseDoc(serializeDoc(appDoc));
  const rtZone = round.records.find(r => r.type === 'ThrmlZn' && r.name === 'TestExhZoneA');
  ok("SizeForDOAS survives serialize/parse", String(rtZone.attrs.SizeForDOAS) === '1');
  ok("SizeForDOASCtrl survives", rtZone.attrs.SizeForDOASCtrl === 'NeutralDehumidifed');
  ok("SizeForDOASTempLow survives", Number(rtZone.attrs.SizeForDOASTempLow) === 60);
  ok("SizeForDOASTempHi survives", Number(rtZone.attrs.SizeForDOASTempHi) === 75);

  const rtExh = round.records.find(r => r.type === 'AirSys' && r.name === 'TestCentralExh');
  ok("exhaust properties survive serialize/parse",
     rtExh && rtExh.attrs.ExhSysType === 'General' &&
     rtExh.attrs.ExhCtrlMthd === 'ConstantFlowConstantSpeedFan');

  // ---- cleanup ------------------------------------------------------------
  [cx, zx, doasSys, crac].forEach(sys => { if(appDoc.records.indexOf(sys) !== -1) deleteSystem(appDoc, sys); });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
