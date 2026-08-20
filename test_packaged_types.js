// Test: the packaged single-zone system types added in v1.16.0, and the supplemental
// heating coil that every heat-pump variant was missing.
//
// Ground truth:
//   ZnSys:SZAC shape ............ all 35 ZnSys:SZAC records in the 2025 corpus
//   AirSys:SZHP + supp coil ..... CUAC-MF36Unit_3Story_NGAS-CZ09.cibd25, and
//                                 627/627 SZHP + 17/19 SZVAVHP heating coils corpus-wide
//   SZHP vs SZDFHP backup ....... Library_HVAC-T24N.rule, ResBaseAirSys_SZHP
//                                 (Resistance SuppCoilHtg) vs ResBaseAirSys_SZDFHP (Furnace)
//   SPVAC/SPVHP ................. no corpus example; Analysis-Control.rule simulates
//                                 them as SZAC/SZHP (AirSys), PTAC/PTHP (ZnSys)
//   SubType option sets ......... T24_2025 Input Data Model, AirSys/ZnSys:SubType

const { win, loadFile } = require('./run_full.js');

const testFile = "C:/Users/CharlieChristenson/OneDrive - Stok LLC/Documents/CBECC 2025 Projects/StandardModelTests/040012-OffLrg-CECStd.cibd25";

async function run(){
  let pass = 0, fail = 0;
  function ok(label, cond){ if(cond){ console.log("  PASS:", label); pass++; } else { console.error("  FAIL:", label); fail++; } }

  await loadFile(testFile);

  const e = expr => win.eval(expr);
  const appDoc = e('doc');
  const HVAC_CHILD_TYPES = e('HVAC_CHILD_TYPES');
  const { createSystem, buildSystemComponents, changeSystemType, deleteSystem,
          systemTypeMeta, hasSubType, subTypesFor, setPlainAttr,
          serializeDoc, parseDoc } = win;

  function childrenOf(sys){
    const idx = appDoc.records.indexOf(sys);
    const kids = [];
    for(let i = idx + 1; i < appDoc.records.length && HVAC_CHILD_TYPES.has(appDoc.records[i].type); i++){
      kids.push(appDoc.records[i]);
    }
    return kids;
  }
  const shapeOf = sys => childrenOf(sys)
    .map(k => k.type + (k.attrs.Type ? '(' + k.attrs.Type + ')' : ''))
    .join(' -> ');

  const made = [];
  function build(type, family, name){
    const sys = createSystem(appDoc, type, name, family);
    buildSystemComponents(appDoc, sys);
    made.push(sys);
    return sys;
  }

  // ---- 1. Every new Type is in the catalog, in the right family ------------
  console.log("\n[1] Catalog coverage");
  [['SZDFHP','AirSys'], ['SZVAVDFHP','AirSys'], ['SPVAC','AirSys'], ['SPVHP','AirSys'],
   ['SZAC','ZnSys'], ['SZHP','ZnSys'], ['SZDFHP','ZnSys'], ['SPVAC','ZnSys'], ['SPVHP','ZnSys']].forEach(([t, f]) => {
    const m = systemTypeMeta(t, f);
    ok(`${f}:${t} present in catalog`, !!m && m.family === f && m.value === t);
  });

  // ---- 2. AirSys packaged shape, with the supplemental coil ---------------
  console.log("\n[2] AirSys packaged shape");
  const AIR_SHAPE_AC = 'AirSeg(Supply) -> CoilClg(DirectExpansion) -> CoilHtg(Furnace) -> Fan -> AirSeg(Return) -> OACtrl';
  const AIR_SHAPE_HP = 'AirSeg(Supply) -> CoilClg(DirectExpansion) -> CoilHtg(HeatPump) -> CoilHtg(SUPP) -> Fan -> AirSeg(Return) -> OACtrl';

  const szac = build('SZAC', 'AirSys', 'T SZAC');
  ok("SZAC has no supplemental coil", shapeOf(szac) === AIR_SHAPE_AC);

  const szhp = build('SZHP', 'AirSys', 'T SZHP');
  ok("SZHP gains a Resistance supplemental coil",
     shapeOf(szhp) === AIR_SHAPE_HP.replace('SUPP', 'Resistance'));
  const szhpHtg = childrenOf(szhp).find(k => k.type === 'CoilHtg' && k.attrs.Type === 'HeatPump');
  ok("SZHP primary coil points at the supplemental coil",
     szhpHtg.attrs.HtPumpSuppCoilHtgRef === 'T SZHP HPSuppHtgCoil');
  ok("the referenced supplemental coil actually exists",
     appDoc.records.some(r => r.type === 'CoilHtg' && r.name === szhpHtg.attrs.HtPumpSuppCoilHtgRef));

  // Dual fuel is exactly SZHP with a gas furnace as the backup.
  const szdfhp = build('SZDFHP', 'AirSys', 'T SZDFHP');
  ok("SZDFHP gains a Furnace supplemental coil",
     shapeOf(szdfhp) === AIR_SHAPE_HP.replace('SUPP', 'Furnace'));
  ok("SZDFHP differs from SZHP only in the backup coil",
     shapeOf(szdfhp).replace('CoilHtg(Furnace) -> Fan', 'CoilHtg(Resistance) -> Fan') === shapeOf(szhp));

  const szvavdfhp = build('SZVAVDFHP', 'AirSys', 'T SZVAVDFHP');
  ok("SZVAVDFHP matches the SZDFHP shape",
     shapeOf(szvavdfhp) === AIR_SHAPE_HP.replace('SUPP', 'Furnace'));

  const spvac = build('SPVAC', 'AirSys', 'T SPVAC');
  ok("SPVAC follows the SZAC shape", shapeOf(spvac) === AIR_SHAPE_AC);
  const spvhp = build('SPVHP', 'AirSys', 'T SPVHP');
  ok("SPVHP follows the SZHP shape",
     shapeOf(spvhp) === AIR_SHAPE_HP.replace('SUPP', 'Resistance'));

  // OACtrl wiring was previously left blank on this branch.
  const oa = childrenOf(szac).find(k => k.type === 'OACtrl');
  ok("OACtrl is wired to both air segments",
     oa.attrs.AirSegSupRef === 'T SZAC Supply AirSeg' && oa.attrs.AirSegRetRef === 'T SZAC Return AirSeg');
  const segs = childrenOf(szac).filter(k => k.type === 'AirSeg');
  ok("air segments carry their Type", segs[0].attrs.Type === 'Supply' && segs[1].attrs.Type === 'Return');

  // ---- 3. ZnSys packaged shape -------------------------------------------
  console.log("\n[3] ZnSys packaged shape");
  const ZN_SHAPE = 'CoilClg(DirectExpansion) -> CoilHtg(Furnace) -> Fan';
  const znSzac = build('SZAC', 'ZnSys', 'T Zn SZAC');
  ok("ZnSys SZAC matches the corpus shape", shapeOf(znSzac) === ZN_SHAPE);
  ok("ZnSys SZAC has no AirSeg or OACtrl",
     !childrenOf(znSzac).some(k => k.type === 'AirSeg' || k.type === 'OACtrl'));
  ok("ZnSys SZAC parent gets FanCtrl = Cycling", znSzac.attrs.FanCtrl === 'Cycling');
  ok("ZnSys SZAC fan is constant volume",
     childrenOf(znSzac).find(k => k.type === 'Fan').attrs.CtrlMthd === 'ConstantVolume');

  // Zone-level heat pumps DO carry a backup coil, and it goes after the Fan -- the one
  // place the zone-level order departs from the AirSys build. Taken from the PTHP ZnSys
  // in 010212-SchSml-PVAVAirZnSys.cibd25 and from the ruleset's own PTHP-ResZnSys
  // library block, which sets HtPumpSuppCoilHtgRef on its CoilHtg.
  const ZN_SHAPE_HP = 'CoilClg(DirectExpansion) -> CoilHtg(HeatPump) -> Fan -> CoilHtg(SUPP)';
  const znSzhp = build('SZHP', 'ZnSys', 'T Zn SZHP');
  ok("ZnSys SZHP gets a HeatPump coil and a Resistance backup after the Fan",
     shapeOf(znSzhp) === ZN_SHAPE_HP.replace('SUPP', 'Resistance'));
  ok("ZnSys SZHP links primary to backup",
     childrenOf(znSzhp).find(k => k.attrs.Type === 'HeatPump').attrs.HtPumpSuppCoilHtgRef === 'T Zn SZHP SuppHtg');

  const znSzdfhp = build('SZDFHP', 'ZnSys', 'T Zn SZDFHP');
  ok("ZnSys SZDFHP swaps the backup to Furnace",
     shapeOf(znSzdfhp) === ZN_SHAPE_HP.replace('SUPP', 'Furnace'));
  ok("the zone-level backup sits after the Fan, unlike the AirSys build",
     shapeOf(znSzdfhp).endsWith('Fan -> CoilHtg(Furnace)') &&
     shapeOf(szdfhp).indexOf('CoilHtg(Furnace) -> Fan') !== -1);

  // Cooling-only and PTHP-family zone units still get none.
  ok("ZnSys SZAC has no backup coil",
     childrenOf(znSzac).filter(k => k.type === 'CoilHtg').length === 1);
  const znSpvhp = build('SPVHP', 'ZnSys', 'T Zn SPVHP');
  ok("ZnSys SPVHP gets none -- it is simulated as PTHP, which mostly has none",
     childrenOf(znSpvhp).filter(k => k.type === 'CoilHtg').length === 1);

  ok("the two SZAC families build different shapes", shapeOf(szac) !== shapeOf(znSzac));

  // ---- 4. SubType option sets --------------------------------------------
  console.log("\n[4] Per-Type SubType option sets");
  ok("AirSys SZAC offers the full list including CRAC/CRAH",
     subTypesFor(systemTypeMeta('SZAC', 'AirSys')).indexOf('CRAC') !== -1);
  ok("SPVAC is restricted to the two packaged options",
     JSON.stringify(subTypesFor(systemTypeMeta('SPVAC', 'AirSys'))) ===
     JSON.stringify(['Packaged3Phase', 'Packaged1Phase']));
  ok("ZnSys SZAC offers packaged/split without CRAC",
     subTypesFor(systemTypeMeta('SZAC', 'ZnSys')).indexOf('CRAC') === -1 &&
     subTypesFor(systemTypeMeta('SZAC', 'ZnSys')).indexOf('Split1Phase') !== -1);
  ok("ZnSys SZAC defaults to Split1Phase, matching all 35 corpus records",
     systemTypeMeta('SZAC', 'ZnSys').subTypeDefault === 'Split1Phase');
  ok("Furnace/Radiant/Evap carry their own SubType vocabularies",
     subTypesFor(systemTypeMeta('Furnace')).indexOf('Wall') !== -1 &&
     subTypesFor(systemTypeMeta('Radiant')).indexOf('Embedded') !== -1 &&
     subTypesFor(systemTypeMeta('EvaporativeCooler')).indexOf('Standard IEC') !== -1);
  ok("Baseboard and PassiveBeam support no SubType",
     !hasSubType(systemTypeMeta('Baseboard')) && !hasSubType(systemTypeMeta('PassiveBeam')));

  // ---- 5. A narrowing Type change drops a now-invalid SubType -------------
  console.log("\n[5] SubType survives or is dropped on Type change");
  setPlainAttr(spvac, 'SubType', 'Packaged1Phase');
  changeSystemType(appDoc, spvac, 'SZAC', {family: 'AirSys'});
  ok("SubType valid under both Types is kept", spvac.attrs.SubType === 'Packaged1Phase');
  setPlainAttr(spvac, 'SubType', 'Split3Phase');       // SZAC allows it, SPVAC does not
  changeSystemType(appDoc, spvac, 'SPVAC', {family: 'AirSys'});
  ok("SubType the new Type disallows is dropped", spvac.attrs.SubType === undefined);
  setPlainAttr(spvac, 'SubType', 'CRAC');
  setPlainAttr(spvac, 'Config', 'Floor-Mounted (Downflow)');
  changeSystemType(appDoc, spvac, 'SZAC', {family: 'AirSys'});
  ok("CRAC-only Config is dropped with a non-CRAC SubType",
     spvac.attrs.SubType === 'CRAC' ? spvac.attrs.Config !== undefined : spvac.attrs.Config === undefined);

  // Rebuilding on a type change must not leave a stale supplemental coil behind.
  console.log("\n[6] Rebuild on Type change");
  changeSystemType(appDoc, szhp, 'SZAC', {family: 'AirSys'});
  ok("switching HP -> AC removes the supplemental coil", shapeOf(szhp) === AIR_SHAPE_AC);
  ok("no orphaned supplemental coil left in the doc",
     !appDoc.records.some(r => r.type === 'CoilHtg' && r.name === 'T SZHP HPSuppHtgCoil'));
  changeSystemType(appDoc, szhp, 'SZDFHP', {family: 'AirSys'});
  ok("switching back to a DF heat pump rebuilds a Furnace backup",
     shapeOf(szhp) === AIR_SHAPE_HP.replace('SUPP', 'Furnace'));

  // ---- 7. Round-trip ------------------------------------------------------
  console.log("\n[7] Round-trip");
  const round = parseDoc(serializeDoc(appDoc));
  const rtHtg = round.records.find(r => r.type === 'CoilHtg' && r.name === 'T SZDFHP CoilHtg');
  ok("supplemental coil reference survives serialize/parse",
     rtHtg && rtHtg.attrs.HtPumpSuppCoilHtgRef === 'T SZDFHP HPSuppHtgCoil');
  ok("the supplemental coil itself survives",
     round.records.some(r => r.type === 'CoilHtg' && r.name === 'T SZDFHP HPSuppHtgCoil' &&
       r.attrs.Type === 'Furnace'));
  const rtZn = round.records.find(r => r.type === 'ZnSys' && r.name === 'T Zn SZAC');
  ok("ZnSys SZAC survives with FanCtrl", rtZn && rtZn.attrs.FanCtrl === 'Cycling');

  // ---- 8. The edit form narrows the SubType list when the Type changes ----
  console.log("\n[8] SubType select tracks the selected Type");
  const doc_ = win.document;
  const host = doc_.createElement('div');
  doc_.body.appendChild(host);
  const fire = (el, type) => el.dispatchEvent(new win.Event(type, {bubbles: true}));

  win.renderHVACSystemsForm(host);
  const created = Array.from(host.querySelector('#sysTypeSelect').options).map(o => o.value);
  ok("both SZAC families are offered in the create picker",
     created.indexOf('SZAC|AirSys') !== -1 && created.indexOf('SZAC|ZnSys') !== -1);
  ok("the dual-fuel and single-package types are offered",
     ['SZDFHP|AirSys','SZVAVDFHP|AirSys','SPVAC|AirSys','SPVHP|AirSys']
       .every(v => created.indexOf(v) !== -1));

  Array.from(host.querySelectorAll('button[data-edit]')).find(b => b.dataset.edit === 'T SZAC').click();
  const sn = 'T_SZAC';
  const subEl  = host.querySelector('#esst_' + sn);
  const typeEl = host.querySelector('#est_' + sn);
  ok("SZAC's SubType select offers CRAC",
     Array.from(subEl.options).map(o => o.value).indexOf('CRAC') !== -1);

  typeEl.value = 'SPVAC|AirSys';
  fire(typeEl, 'change');
  const narrowed = Array.from(host.querySelector('#esst_' + sn).options).map(o => o.value).filter(Boolean);
  ok("switching to SPVAC narrows SubType to the two packaged options",
     JSON.stringify(narrowed) === JSON.stringify(['Packaged3Phase', 'Packaged1Phase']));

  typeEl.value = 'Exhaust|AirSys';
  fire(typeEl, 'change');
  ok("switching to Exhaust hides SubType and shows the exhaust rows",
     host.querySelector('#esst_' + sn).style.display === 'none' &&
     host.querySelector('#eset_' + sn).style.display !== 'none');

  made.forEach(sys => { if(appDoc.records.indexOf(sys) !== -1) deleteSystem(appDoc, sys); });
  ok("all test systems removed cleanly",
     !appDoc.records.some(r => r.name.indexOf('T SZ') === 0 || r.name.indexOf('T Zn') === 0 ||
                               r.name.indexOf('T SPV') === 0));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
