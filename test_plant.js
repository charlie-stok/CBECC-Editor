// Test: water-side plant equipment (Stage 5)
// Uses the same jsdom harness as run_full.js.
// Tests createFluidLoop, deleteFluidLoop, wireCoilsToLoop,
// placement ordering, and round-trip serialization.

const { dom, win, doc_, loadFile, clickStepByTitle } = require('./run_full.js');

const testFile = "C:/Users/CharlieChristenson/OneDrive - Stok LLC/Documents/CBECC 2025 Projects/StandardModelTests/040012-OffLrg-CECStd.cibd25";

async function run(){
  let pass = 0, fail = 0;
  function ok(label, cond){ if(cond){ console.log("  PASS:", label); pass++; } else { console.error("  FAIL:", label); fail++; } }

  await loadFile(testFile);

  // let/const don't attach to window; access via eval in the jsdom context.
  const e = (expr) => win.eval(expr);
  const parseDoc      = win.parseDoc;
  const serializeDoc  = win.serializeDoc;
  const createFluidLoop = win.createFluidLoop;
  const deleteFluidLoop = win.deleteFluidLoop;
  const wireCoilsToLoop = win.wireCoilsToLoop;
  const FLUID_CHILD_TYPES = e('FLUID_CHILD_TYPES');
  const setPlainAttr  = win.setPlainAttr;
  const makeRecord    = win.makeRecord;

  // Grab the live doc from the app's global (let variable, must use eval)
  const appDoc = e('doc');
  ok("File loaded — doc exists", !!appDoc);
  ok("FLUID_CHILD_TYPES defined", !!FLUID_CHILD_TYPES);

  // -----------------------------------------------------------------------
  // 1. Existing FluidSys records from the real file (SHW + HW + CW + ChW)
  // -----------------------------------------------------------------------
  const existingFluidSys = appDoc.records.filter(r => r.type === "FluidSys");
  ok("Real file has FluidSys records", existingFluidSys.length >= 1);

  // -----------------------------------------------------------------------
  // 2. createFluidLoop — HotWater
  // -----------------------------------------------------------------------
  const hwLoop = createFluidLoop(appDoc, "HotWater", "Test HW Loop");
  ok("HW FluidSys created", !!appDoc.records.find(r => r.type === "FluidSys" && r.name === "Test HW Loop"));
  const hwIdx = appDoc.records.indexOf(hwLoop);
  const hwChildren = [];
  let ci = hwIdx + 1;
  while(ci < appDoc.records.length && FLUID_CHILD_TYPES.has(appDoc.records[ci].type)) hwChildren.push(appDoc.records[ci++]);
  ok("HW loop has PrimarySupply FluidSeg",  hwChildren.some(r => r.type === "FluidSeg" && r.attrs.Type === "PrimarySupply"));
  ok("HW loop has PrimaryReturn FluidSeg",  hwChildren.some(r => r.type === "FluidSeg" && r.attrs.Type === "PrimaryReturn"));
  ok("HW loop has Blr",                     hwChildren.some(r => r.type === "Blr"));
  ok("HW loop has Pump",                    hwChildren.some(r => r.type === "Pump"));
  const hwBlr = hwChildren.find(r => r.type === "Blr");
  ok("Blr.FluidSegInRef = PrimRetSeg",  hwBlr && hwBlr.attrs.FluidSegInRef === "Test HW Loop PrimRetSeg");
  ok("Blr.FluidSegOutRef = PrimSupSeg", hwBlr && hwBlr.attrs.FluidSegOutRef === "Test HW Loop PrimSupSeg");

  // -----------------------------------------------------------------------
  // 3. A second loop of a type leaves existing demand wiring alone
  // -----------------------------------------------------------------------
  // This file already ships a HotWater loop (BaseHWSystem), so "Test HW Loop" is the
  // SECOND of its type. createFluidLoop's isFirstOfType guard deliberately skips
  // auto-wiring there, so a new loop can't steal demand equipment off the existing
  // one. The first-of-type path that does wire is covered in section 9.
  const hwCoils = appDoc.records.filter(r => r.type === "CoilHtg" && r.attrs.Type === "HotWater");
  ok("HW coils exist in real file", hwCoils.length > 0);
  const origHwSup = hwCoils[0].attrs.FluidSegInRef;
  const origHwRet = hwCoils[0].attrs.FluidSegOutRef;
  ok("HW coils start wired to the file's own loop",
     !!origHwSup && origHwSup !== "Test HW Loop PrimSupSeg");
  ok("second HW loop leaves coil supply refs alone",
     hwCoils.every(c => c.attrs.FluidSegInRef === origHwSup));
  ok("second HW loop leaves coil return refs alone",
     hwCoils.every(c => c.attrs.FluidSegOutRef === origHwRet));

  // -----------------------------------------------------------------------
  // 4. createFluidLoop — ChilledWater, air-cooled
  // -----------------------------------------------------------------------
  const chWLoop = createFluidLoop(appDoc, "ChilledWater", "Test ChW Loop", {cndsrType: "Air"});
  ok("ChW FluidSys created", !!appDoc.records.find(r => r.type === "FluidSys" && r.name === "Test ChW Loop"));
  const chWIdx = appDoc.records.indexOf(chWLoop);
  const chWChildren = [];
  let di = chWIdx + 1;
  while(di < appDoc.records.length && FLUID_CHILD_TYPES.has(appDoc.records[di].type)) chWChildren.push(appDoc.records[di++]);
  ok("ChW loop has Chlr",                   chWChildren.some(r => r.type === "Chlr"));
  ok("ChW loop Chlr CndsrType=Air",         chWChildren.find(r => r.type === "Chlr").attrs.CndsrType === "Air");
  ok("ChW loop Chlr has no CndsrFluidSegInRef", !chWChildren.find(r => r.type === "Chlr").attrs.CndsrFluidSegInRef);
  const chWChlr = chWChildren.find(r => r.type === "Chlr");
  ok("Chlr.EvapFluidSegInRef = PrimRetSeg",  chWChlr.attrs.EvapFluidSegInRef === "Test ChW Loop PrimRetSeg");
  ok("Chlr.EvapFluidSegOutRef = PrimSupSeg", chWChlr.attrs.EvapFluidSegOutRef === "Test ChW Loop PrimSupSeg");

  // Same second-of-type guard as the HW case above — the file ships BaseChWSystem.
  const chWCoils = appDoc.records.filter(r => r.type === "CoilClg" && r.attrs.Type === "ChilledWater");
  ok("ChW coils exist in real file", chWCoils.length > 0);
  const origChWSup = chWCoils[0].attrs.FluidSegInRef;
  const origChWRet = chWCoils[0].attrs.FluidSegOutRef;
  ok("ChW coils start wired to the file's own loop",
     !!origChWSup && origChWSup !== "Test ChW Loop PrimSupSeg");
  ok("second ChW loop leaves coil supply refs alone",
     chWCoils.every(c => c.attrs.FluidSegInRef === origChWSup));
  ok("second ChW loop leaves coil return refs alone",
     chWCoils.every(c => c.attrs.FluidSegOutRef === origChWRet));

  // -----------------------------------------------------------------------
  // 5. createFluidLoop — CondenserWater; verify HtRej wiring
  // -----------------------------------------------------------------------
  const cwLoop = createFluidLoop(appDoc, "CondenserWater", "Test CW Loop");
  ok("CW FluidSys created", !!appDoc.records.find(r => r.type === "FluidSys" && r.name === "Test CW Loop"));
  const cwIdx = appDoc.records.indexOf(cwLoop);
  const cwChildren = [];
  let ei = cwIdx + 1;
  while(ei < appDoc.records.length && FLUID_CHILD_TYPES.has(appDoc.records[ei].type)) cwChildren.push(appDoc.records[ei++]);
  ok("CW loop has HtRej",         cwChildren.some(r => r.type === "HtRej"));
  const htrej = cwChildren.find(r => r.type === "HtRej");
  ok("HtRej.FluidSegInRef = PrimRetSeg",  htrej.attrs.FluidSegInRef === "Test CW Loop PrimRetSeg");
  ok("HtRej.FluidSegOutRef = PrimSupSeg", htrej.attrs.FluidSegOutRef === "Test CW Loop PrimSupSeg");

  // -----------------------------------------------------------------------
  // 6. Placement: FluidSys records are after AirSys block, before library content
  // -----------------------------------------------------------------------
  const newHwIdx  = appDoc.records.indexOf(hwLoop);
  const newChWIdx = appDoc.records.indexOf(chWLoop);
  const newCwIdx  = appDoc.records.indexOf(cwLoop);
  const lastAirSysIdx = appDoc.records.reduce((last, r, i) => r.type === "AirSys" ? i : last, -1);
  const firstMatIdx   = appDoc.records.findIndex(r => r.type === "Mat" && appDoc.records.indexOf(r) > newCwIdx);
  ok("New FluidSys blocks appear after last AirSys",    newHwIdx > lastAirSysIdx && newChWIdx > lastAirSysIdx && newCwIdx > lastAirSysIdx);

  // -----------------------------------------------------------------------
  // 7. Round-trip: serialize and re-parse; verify records survive
  // -----------------------------------------------------------------------
  const serialized = serializeDoc(appDoc);
  ok("Serialized output is non-empty", serialized.length > 1000);
  ok("CRLF line endings in output",    serialized.includes("\r\n"));
  ok("Test HW Loop appears in output", serialized.includes('FluidSys   "Test HW Loop"'));
  ok("Test ChW Loop appears in output", serialized.includes('FluidSys   "Test ChW Loop"'));
  ok("Chlr appears in output",          serialized.includes('Chlr   "Test ChW Loop Chlr"'));
  ok("Blr appears in output",           serialized.includes('Blr   "Test HW Loop Blr"'));
  ok("FluidSeg supply appears in output", serialized.includes('FluidSeg   "Test HW Loop PrimSupSeg"'));
  // The coils are still on the file's original loops (section 3), so those are the
  // refs that must survive serialization.
  ok("CoilHtg ref in output",           serialized.includes('FluidSegInRef = "' + origHwSup + '"'));
  ok("CoilClg ref in output",           serialized.includes('FluidSegInRef = "' + origChWSup + '"'));
  ok("no coil was silently moved onto the second HW loop",
     !serialized.includes('FluidSegInRef = "Test HW Loop PrimSupSeg"'));
  ok("no coil was silently moved onto the second ChW loop",
     !serialized.includes('FluidSegInRef = "Test ChW Loop PrimSupSeg"'));

  const reparsed = parseDoc(serialized);
  ok("Re-parsed doc has records",      reparsed.records.length > 0);
  ok("HW FluidSys survives round-trip",  reparsed.records.some(r => r.type === "FluidSys" && r.name === "Test HW Loop"));
  ok("ChW FluidSys survives round-trip", reparsed.records.some(r => r.type === "FluidSys" && r.name === "Test ChW Loop"));
  ok("Blr survives round-trip",          reparsed.records.some(r => r.type === "Blr" && r.name === "Test HW Loop Blr"));
  ok("Chlr survives round-trip",         reparsed.records.some(r => r.type === "Chlr" && r.name === "Test ChW Loop Chlr"));
  const rpHwCoil = reparsed.records.find(r => r.type === "CoilHtg" && r.attrs.Type === "HotWater");
  ok("CoilHtg FluidSegInRef survives round-trip", rpHwCoil && rpHwCoil.attrs.FluidSegInRef === origHwSup);
  const rpChWCoil = reparsed.records.find(r => r.type === "CoilClg" && r.attrs.Type === "ChilledWater");
  ok("CoilClg FluidSegInRef survives round-trip", rpChWCoil && rpChWCoil.attrs.FluidSegInRef === origChWSup);

  // -----------------------------------------------------------------------
  // 8. deleteFluidLoop — removes records, and only un-wires its own demands
  // -----------------------------------------------------------------------
  deleteFluidLoop(appDoc, hwLoop);
  ok("HW FluidSys removed",  !appDoc.records.find(r => r.type === "FluidSys" && r.name === "Test HW Loop"));
  ok("HW Blr removed",       !appDoc.records.find(r => r.type === "Blr" && r.name === "Test HW Loop Blr"));
  ok("HW FluidSeg removed",  !appDoc.records.find(r => r.type === "FluidSeg" && r.name === "Test HW Loop PrimSupSeg"));
  // deleteFluidLoop clears refs pointing at the deleted loop's own segments. These
  // coils were never on it (section 3), so their wiring must be untouched.
  const afterDeleteCoils = appDoc.records.filter(r => r.type === "CoilHtg" && r.attrs.Type === "HotWater");
  ok("deleting an unrelated HW loop leaves coil wiring intact",
     afterDeleteCoils.every(c => c.attrs.FluidSegInRef === origHwSup));

  deleteFluidLoop(appDoc, chWLoop);
  ok("ChW FluidSys removed", !appDoc.records.find(r => r.type === "FluidSys" && r.name === "Test ChW Loop"));
  const afterDeleteChWCoils = appDoc.records.filter(r => r.type === "CoilClg" && r.attrs.Type === "ChilledWater");
  ok("deleting an unrelated ChW loop leaves coil wiring intact",
     afterDeleteChWCoils.every(c => c.attrs.FluidSegInRef === origChWSup));

  // -----------------------------------------------------------------------
  // 9. First-of-type auto-wire, and un-wiring on delete
  // -----------------------------------------------------------------------
  // Section 3 covers the guard; this covers the path it guards. Removing the file's
  // own HotWater loop leaves zero loops of that type, so the next one created is
  // first-of-type and should pick up every HotWater coil.
  const baseHw = appDoc.records.find(r => r.type === "FluidSys" && r.attrs.Type === "HotWater");
  ok("file's own HW loop still present before this section", !!baseHw);
  deleteFluidLoop(appDoc, baseHw);
  const orphaned = appDoc.records.filter(r => r.type === "CoilHtg" && r.attrs.Type === "HotWater");
  ok("deleting the loop a coil IS on clears its refs",
     orphaned.every(c => !c.attrs.FluidSegInRef && !c.attrs.FluidSegOutRef));
  ok("no HotWater loop remains",
     !appDoc.records.some(r => r.type === "FluidSys" && r.attrs.Type === "HotWater"));

  const freshHw = createFluidLoop(appDoc, "HotWater", "Fresh HW Loop");
  const rewired = appDoc.records.filter(r => r.type === "CoilHtg" && r.attrs.Type === "HotWater");
  ok("first-of-type HW loop wires coil supply refs",
     rewired.length > 0 && rewired.every(c => c.attrs.FluidSegInRef === "Fresh HW Loop PrimSupSeg"));
  ok("first-of-type HW loop wires coil return refs",
     rewired.every(c => c.attrs.FluidSegOutRef === "Fresh HW Loop PrimRetSeg"));

  // wireCoilsToLoop is exercised transitively above; call it directly to pin the
  // contract it's imported for.
  wireCoilsToLoop(appDoc, "HotWater", "Manual SupSeg", "Manual RetSeg");
  ok("wireCoilsToLoop retargets every matching coil",
     rewired.every(c => c.attrs.FluidSegInRef === "Manual SupSeg" &&
                        c.attrs.FluidSegOutRef === "Manual RetSeg"));
  // It keys off coil Type, so ChilledWater coils must be left alone.
  ok("wireCoilsToLoop ignores coils of another loop type",
     appDoc.records.filter(r => r.type === "CoilClg" && r.attrs.Type === "ChilledWater")
       .every(c => c.attrs.FluidSegInRef === origChWSup));
  deleteFluidLoop(appDoc, freshHw);

  // -----------------------------------------------------------------------
  // 10. Regression: existing AirSys/TrmlUnit structure not corrupted
  // -----------------------------------------------------------------------
  const airSysList = appDoc.records.filter(r => r.type === "AirSys");
  ok("AirSys records still present", airSysList.length > 0);
  const trmlUnits  = appDoc.records.filter(r => r.type === "TrmlUnit");
  ok("TrmlUnit records still present", trmlUnits.length > 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
