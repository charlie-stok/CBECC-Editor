// Test: VAV zone drag-and-drop TrmlUnit cleanup
// Verifies that moveSpaceToZone correctly removes TrmlUnit+CoilHtg when a VAV
// zone loses its last space, and works correctly for cross-system moves.

const { dom, win, doc_, loadFile, clickStepByTitle } = require('./run_full.js');

const testFile = "C:/Users/CharlieChristenson/OneDrive - Stok LLC/Documents/CBECC 2025 Projects/StandardModelTests/040012-OffLrg-CECStd.cibd25";

async function run(){
  let pass = 0, fail = 0;
  function ok(label, cond){ if(cond){ console.log("  PASS:", label); pass++; } else { console.error("  FAIL:", label); fail++; } }

  await loadFile(testFile);

  const e = (expr) => win.eval(expr);
  const appDoc           = e('doc');
  const createSystem     = win.createSystem;
  const buildSystemComponents = win.buildSystemComponents;
  const assignZoneToVavSys    = win.assignZoneToVavSys;
  const getOrCreateThrmlZn    = win.getOrCreateThrmlZn;
  const setPlainAttr     = win.setPlainAttr;
  const makeRecord       = win.makeRecord;
  const serializeDoc     = win.serializeDoc;
  const parseDoc         = win.parseDoc;

  // -----------------------------------------------------------------------
  // Set up two VAV systems, each with two zones, each zone with one space
  // -----------------------------------------------------------------------
  const ahu1 = createSystem(appDoc, "VAV", "TestAHU-1");
  ahu1._clgCoilType = "DirectExpansion";
  buildSystemComponents(appDoc, ahu1);
  ahu1._componentsBuilt = true;

  const ahu2 = createSystem(appDoc, "VAV", "TestAHU-2");
  ahu2._clgCoilType = "DirectExpansion";
  buildSystemComponents(appDoc, ahu2);
  ahu2._componentsBuilt = true;

  // Create four zones manually
  const zoneA = getOrCreateThrmlZn(appDoc, "TestZoneA");
  const zoneB = getOrCreateThrmlZn(appDoc, "TestZoneB");
  const zoneC = getOrCreateThrmlZn(appDoc, "TestZoneC");
  const zoneD = getOrCreateThrmlZn(appDoc, "TestZoneD");

  // Assign zones to systems (creates TrmlUnits)
  assignZoneToVavSys(appDoc, zoneA, ahu1);
  assignZoneToVavSys(appDoc, zoneB, ahu1);
  assignZoneToVavSys(appDoc, zoneC, ahu2);
  assignZoneToVavSys(appDoc, zoneD, ahu2);

  // Create one space per zone
  const spcA = makeRecord("Spc", "TestSpcA");
  setPlainAttr(spcA, "ThrmlZnRef", "TestZoneA");
  const spcB = makeRecord("Spc", "TestSpcB");
  setPlainAttr(spcB, "ThrmlZnRef", "TestZoneB");
  const spcC = makeRecord("Spc", "TestSpcC");
  setPlainAttr(spcC, "ThrmlZnRef", "TestZoneC");
  const spcD = makeRecord("Spc", "TestSpcD");
  setPlainAttr(spcD, "ThrmlZnRef", "TestZoneD");
  appDoc.records.push(spcA, spcB, spcC, spcD);

  // Verify baseline TrmlUnits exist
  const tuCount = () => appDoc.records.filter(r => r.type === "TrmlUnit").length;
  const tuFor   = (znName) => appDoc.records.find(r => r.type === "TrmlUnit" && r.attrs.ZnServedRef === znName);
  const zoneExists = (name) => appDoc.records.some(r => r.type === "ThrmlZn" && r.name === name);

  // The file itself has TrmlUnits from its real systems; count ours specifically
  ok("TrmlUnit exists for TestZoneA", !!tuFor("TestZoneA"));
  ok("TrmlUnit exists for TestZoneB", !!tuFor("TestZoneB"));
  ok("TrmlUnit exists for TestZoneC", !!tuFor("TestZoneC"));
  ok("TrmlUnit exists for TestZoneD", !!tuFor("TestZoneD"));

  // -----------------------------------------------------------------------
  // Case 1: drag SpcA from ZoneA (AHU-1) to ZoneB (AHU-1, same system)
  // ZoneA should lose its TrmlUnit and be deleted; ZoneB keeps its TrmlUnit
  // -----------------------------------------------------------------------
  // moveSpaceToZone is a closure inside renderThermalZoneForm; call the
  // underlying pieces directly (same as what the closure does)
  const removeZoneFromVavSys = win.removeZoneFromVavSys;
  const cleanupOrphanedZones = win.cleanupOrphanedZones;
  const systemTypeMeta = win.systemTypeMeta;
  const deletePlainAttr = win.deletePlainAttr;

  function simulateDrag(spc, targetZoneName){
    const oldZoneName = spc.attrs.ThrmlZnRef;
    const oldZone = oldZoneName ? appDoc.records.find(r => r.type === "ThrmlZn" && r.name === oldZoneName) : null;
    if(targetZoneName){
      getOrCreateThrmlZn(appDoc, targetZoneName);
      setPlainAttr(spc, "ThrmlZnRef", targetZoneName);
    } else {
      deletePlainAttr(spc, "ThrmlZnRef");
    }
    if(oldZone){
      const stillHasSpaces = appDoc.records.some(r => r.type === "Spc" && r.attrs.ThrmlZnRef === oldZone.name);
      if(!stillHasSpaces){
        const ref = oldZone.attrs.PriAirCondgSysRef;
        const sysName = (ref && ref.__indexed) ? ref.values[1] : null;
        const oldSys = sysName ? appDoc.records.find(r => (r.type === "AirSys" || r.type === "ZnSys") && r.name === sysName) : null;
        const oldMeta = oldSys ? systemTypeMeta(oldSys.attrs.Type) : null;
        if(oldMeta && oldMeta.isVav) removeZoneFromVavSys(appDoc, oldZone, oldSys);
      }
    }
    cleanupOrphanedZones(appDoc);
  }

  simulateDrag(spcA, "TestZoneB");

  ok("SpcA now in ZoneB",          spcA.attrs.ThrmlZnRef === "TestZoneB");
  ok("ZoneA deleted (empty+cleaned)", !zoneExists("TestZoneA"));
  ok("TrmlUnit for ZoneA removed",    !tuFor("TestZoneA"));
  ok("ZoneB still exists",            zoneExists("TestZoneB"));
  ok("TrmlUnit for ZoneB still exists", !!tuFor("TestZoneB"));

  // -----------------------------------------------------------------------
  // Case 2: drag SpcB from ZoneB (AHU-1) to ZoneC (AHU-2, different system)
  // ZoneB now only has SpcA — not empty, TrmlUnit should stay
  // -----------------------------------------------------------------------
  simulateDrag(spcB, "TestZoneC");

  ok("SpcB now in ZoneC",              spcB.attrs.ThrmlZnRef === "TestZoneC");
  ok("ZoneB still exists (SpcA left)", zoneExists("TestZoneB"));
  ok("TrmlUnit for ZoneB still exists (SpcA left)", !!tuFor("TestZoneB"));
  ok("ZoneC still exists",             zoneExists("TestZoneC"));
  ok("TrmlUnit for ZoneC still exists", !!tuFor("TestZoneC"));

  // -----------------------------------------------------------------------
  // Case 3: drag SpcA from ZoneB (AHU-1, last space) to ZoneC (AHU-2)
  // ZoneB becomes empty → TrmlUnit removed; ZoneC gains a second space
  // -----------------------------------------------------------------------
  simulateDrag(spcA, "TestZoneC");

  ok("SpcA now in ZoneC",                spcA.attrs.ThrmlZnRef === "TestZoneC");
  ok("ZoneB deleted (now empty)",         !zoneExists("TestZoneB"));
  ok("TrmlUnit for ZoneB removed",        !tuFor("TestZoneB"));
  // ZoneC already had SpcC; SpcB moved in Case 2 and SpcA in Case 3 → 3 spaces total
  ok("ZoneC has SpcA, SpcB, and SpcC",
     appDoc.records.filter(r => r.type === "Spc" && r.attrs.ThrmlZnRef === "TestZoneC").length === 3);
  ok("TrmlUnit for ZoneC still exists", !!tuFor("TestZoneC"));
  ok("AHU-1 OACtrl still present",      appDoc.records.some(r => r.type === "OACtrl" && r.name.includes("TestAHU-1")));

  // -----------------------------------------------------------------------
  // Case 4: drag SpcD to unzoned (null)
  // ZoneD becomes empty → TrmlUnit removed
  // -----------------------------------------------------------------------
  simulateDrag(spcD, null);

  ok("SpcD is now unzoned",          !spcD.attrs.ThrmlZnRef);
  ok("ZoneD deleted",                !zoneExists("TestZoneD"));
  ok("TrmlUnit for ZoneD removed",   !tuFor("TestZoneD"));

  // -----------------------------------------------------------------------
  // Round-trip: serialize, reparse, check no orphaned TrmlUnit remains
  // -----------------------------------------------------------------------
  const serialized = serializeDoc(appDoc);
  const reparsed   = parseDoc(serialized);
  const rpTuA = reparsed.records.find(r => r.type === "TrmlUnit" && r.attrs.ZnServedRef === "TestZoneA");
  const rpTuB = reparsed.records.find(r => r.type === "TrmlUnit" && r.attrs.ZnServedRef === "TestZoneB");
  const rpTuD = reparsed.records.find(r => r.type === "TrmlUnit" && r.attrs.ZnServedRef === "TestZoneD");
  ok("No orphaned TrmlUnit for ZoneA after round-trip", !rpTuA);
  ok("No orphaned TrmlUnit for ZoneB after round-trip", !rpTuB);
  ok("No orphaned TrmlUnit for ZoneD after round-trip", !rpTuD);
  ok("TrmlUnit for ZoneC survives round-trip", !!reparsed.records.find(r => r.type === "TrmlUnit" && r.attrs.ZnServedRef === "TestZoneC"));

  // AHU-1 and AHU-2 AirSys records should still be present (not deleted by zone cleanup)
  ok("AHU-1 AirSys survives", reparsed.records.some(r => r.type === "AirSys" && r.name === "TestAHU-1"));
  ok("AHU-2 AirSys survives", reparsed.records.some(r => r.type === "AirSys" && r.name === "TestAHU-2"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
