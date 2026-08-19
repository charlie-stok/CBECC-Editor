// Test: code-year handling.
//   1. An unrecognised or withdrawn system Type is preserved, never silently retyped
//      or stripped of its subcomponents.
//   2. Occupancy/ventilation numeric defaults are never borrowed from another cycle.
//   3. Which system Types are offerable is gated on the file's code year, in both
//      directions, and the checked-in tables still match the installed data models.

const { execFileSync } = require('child_process');
const fs = require('fs');
const { win, loadFile } = require('./run_full.js');

const testFile = "C:/Users/CharlieChristenson/OneDrive - Stok LLC/Documents/CBECC 2025 Projects/StandardModelTests/040012-OffLrg-CECStd.cibd25";

async function run(){
  let pass = 0, fail = 0;
  function ok(label, cond){ if(cond){ console.log("  PASS:", label); pass++; } else { console.error("  FAIL:", label); fail++; } }

  await loadFile(testFile);

  const e = expr => win.eval(expr);
  const appDoc = e('doc');
  const doc_ = win.document;
  const HVAC_CHILD_TYPES = e('HVAC_CHILD_TYPES');
  const { makeRecord, setPlainAttr, deletePlainAttr, deleteSystem, createSystem,
          buildSystemComponents, getCodeYear, hasOccupancyDefaults, hasRulesetData,
          getSpcFuncList, getSpcFuncListYear, getSpcFuncDefaults, getVentFuncDefaults,
          getVentFuncOptions, applyOccupancyDefaults, applyVentilationDefaults,
          typeAllowedInYear, availableSystemTypes, systemTypeMeta } = win;

  const fire = (el, type) => el.dispatchEvent(new win.Event(type, {bubbles: true}));
  function childrenOf(sys){
    const idx = appDoc.records.indexOf(sys);
    const kids = [];
    for(let i = idx + 1; i < appDoc.records.length && HVAC_CHILD_TYPES.has(appDoc.records[i].type); i++) kids.push(appDoc.records[i]);
    return kids;
  }
  const setYear = y => { appDoc.codeYear = y; };

  // ---- 1. Unrecognised Types survive contact with the editor --------------
  console.log("\n[1] An unrecognised Type is preserved");
  setYear(2025);
  const legacy = makeRecord('ZnSys', 'Legacy Unit');
  setPlainAttr(legacy, 'Type', 'SomeWithdrawnType');
  appDoc.records.push(legacy);
  const strayCoil = makeRecord('CoilClg', 'Legacy Unit CoilClg');
  setPlainAttr(strayCoil, 'Type', 'DirectExpansion');
  appDoc.records.splice(appDoc.records.indexOf(legacy) + 1, 0, strayCoil);

  ok("catalog genuinely does not know the Type", systemTypeMeta('SomeWithdrawnType') === undefined);
  buildSystemComponents(appDoc, legacy);
  ok("buildSystemComponents leaves its children alone",
     childrenOf(legacy).length === 1 && childrenOf(legacy)[0].name === 'Legacy Unit CoilClg');

  const host = doc_.createElement('div');
  doc_.body.appendChild(host);
  win.renderHVACSystemsForm(host);
  ok("the system still renders in the list", host.textContent.indexOf('Legacy Unit') !== -1);
  ok("and is flagged as unrecognised", host.textContent.indexOf('unrecognised type') !== -1);

  Array.from(host.querySelectorAll('button[data-edit]')).find(b => b.dataset.edit === 'Legacy Unit').click();
  const selUnknown = host.querySelector('#est_Legacy_Unit');
  ok("the edit form pre-selects the record's own Type, not the first option",
     selUnknown.value === 'SomeWithdrawnType|ZnSys');

  // The regression this whole fix exists for: rename only, then save.
  host.querySelector('#esn_Legacy_Unit').value = 'Legacy Unit Renamed';
  Array.from(host.querySelectorAll('button[data-save]')).find(b => b.dataset.save === 'Legacy Unit').click();
  ok("a rename-only save does NOT retype the system", legacy.attrs.Type === 'SomeWithdrawnType');
  ok("the rename itself still applied", legacy.name === 'Legacy Unit Renamed');
  ok("subcomponents survived the save", childrenOf(legacy).length === 1);

  // ---- 2. Numeric defaults never come from another cycle ------------------
  console.log("\n[2] Occupancy defaults are year-gated");
  const spc = appDoc.records.find(r => r.type === 'Spc');
  const OCC = 'Office Area (>250 square feet)';
  const FIELDS = ['RecptPwrDens','VentPerArea','VentPerPerson','ExhPerArea'];

  setYear(2025);
  FIELDS.forEach(k => deletePlainAttr(spc, k));
  ok("2025 has defaults and fills them",
     applyOccupancyDefaults(spc, OCC) === true && spc.attrs.RecptPwrDens !== undefined);

  for(const y of [2019, 2028]){
    setYear(y);
    FIELDS.forEach(k => deletePlainAttr(spc, k));
    const ret = applyOccupancyDefaults(spc, OCC);
    ok(`${y}: hasOccupancyDefaults() is false`, hasOccupancyDefaults() === false);
    ok(`${y}: getSpcFuncDefaults() returns null, not another year's table`,
       getSpcFuncDefaults() === null);
    ok(`${y}: applyOccupancyDefaults writes nothing and reports it`,
       ret === false && FIELDS.every(k => spc.attrs[k] === undefined));
    ok(`${y}: applyVentilationDefaults also writes nothing`,
       applyVentilationDefaults(spc, 'Office - Office space', 100) === false &&
       spc.attrs.VentPerArea === undefined);
  }

  setYear(2019);
  ok("2019 has no ruleset data at all", hasRulesetData() === false);
  ok("2019 borrows an enum list and says which year it came from",
     getSpcFuncListYear() === 2025 && getSpcFuncList().length > 0);
  ok("2019 ventilation options are empty rather than 2025's", getVentFuncOptions().length === 0);

  setYear(2028);
  ok("2028 has its own enum list, so nothing is borrowed",
     hasRulesetData() === true && getSpcFuncListYear() === 2028);

  // The notice has to appear for any year lacking tables, not just 2028.
  console.log("\n[2b] The partial-support notice tracks the data, not a hardcoded year");
  for(const [y, expect] of [[2025, false], [2028, true], [2019, true], [2022, false]]){
    setYear(y);
    const h = doc_.createElement('div'); doc_.body.appendChild(h);
    win.renderSpcFuncForm(h);
    const shown = h.textContent.indexOf('partial support') !== -1;
    ok(`T24-${y}: notice ${expect ? 'shown' : 'absent'}`, shown === expect);
    if(expect) ok(`T24-${y}: notice names the file's own year`, h.textContent.indexOf('T24-' + y) !== -1);
    h.remove();
  }
  setYear(2019);
  const h19 = doc_.createElement('div'); doc_.body.appendChild(h19);
  win.renderSpcFuncForm(h19);
  ok("2019 notice explains the vocabulary is borrowed",
     h19.textContent.indexOf('no occupancy vocabulary') !== -1 && h19.textContent.indexOf('T24-2025') !== -1);
  h19.remove();

  // ---- 3. Type availability is gated per year, both directions ------------
  console.log("\n[3] Type availability per code year");
  ok("EvaporativeCooler is allowed in 2025", typeAllowedInYear('EvaporativeCooler', 'ZnSys', 2025));
  ok("EvaporativeCooler is NOT allowed in 2022", !typeAllowedInYear('EvaporativeCooler', 'ZnSys', 2022));
  ok("a type present in both years is allowed in both",
     typeAllowedInYear('VRF', 'ZnSys', 2022) && typeAllowedInYear('VRF', 'ZnSys', 2025));
  ok("an unmodelled year permits everything rather than offering nothing",
     typeAllowedInYear('EvaporativeCooler', 'ZnSys', 2019));

  setYear(2022);
  const avail2022 = availableSystemTypes().map(t => t.value + '|' + t.family);
  setYear(2025);
  const avail2025 = availableSystemTypes().map(t => t.value + '|' + t.family);
  ok("the 2022 picker omits EvaporativeCooler", avail2022.indexOf('EvaporativeCooler|ZnSys') === -1);
  ok("the 2025 picker offers it", avail2025.indexOf('EvaporativeCooler|ZnSys') !== -1);
  ok("only that one type differs between the two cycles",
     avail2025.filter(v => avail2022.indexOf(v) === -1).join() === 'EvaporativeCooler|ZnSys' &&
     avail2022.filter(v => avail2025.indexOf(v) === -1).length === 0);

  // A withdrawn-but-known type: real in this catalog, absent from the file's cycle.
  console.log("\n[3b] A type valid in another cycle is preserved, not rewritten");
  setYear(2025);
  const evap = createSystem(appDoc, 'EvaporativeCooler', 'T Evap', 'ZnSys');
  buildSystemComponents(appDoc, evap);
  setYear(2022);
  const h2 = doc_.createElement('div'); doc_.body.appendChild(h2);
  win.renderHVACSystemsForm(h2);
  ok("it is flagged as out-of-cycle for a 2022 file", h2.textContent.indexOf('not in T24-2022') !== -1);
  Array.from(h2.querySelectorAll('button[data-edit]')).find(b => b.dataset.edit === 'T Evap').click();
  const selEvap = h2.querySelector('#est_T_Evap');
  ok("the edit form still pre-selects it", selEvap.value === 'EvaporativeCooler|ZnSys');
  ok("and labels it as outside this cycle",
     selEvap.options[0].textContent.indexOf('not in T24-2022') !== -1);
  h2.querySelector('#esn_T_Evap').value = 'T Evap Renamed';
  Array.from(h2.querySelectorAll('button[data-save]')).find(b => b.dataset.save === 'T Evap').click();
  ok("renaming it under a 2022 file does not retype it", evap.attrs.Type === 'EvaporativeCooler');

  // ---- 4. The checked-in tables still match the shipped data models -------
  console.log("\n[4] Generated tables vs installed rulesets");
  let checked = false;
  try {
    execFileSync(process.execPath, ['tools/extract_ruleset_enums.js', '--check'], {stdio: 'pipe'});
    checked = true;
  } catch(err){
    const out = String(err.stdout || '') + String(err.stderr || '');
    if(err.status === 2 || /No data models found|skipped/.test(out)){
      console.log("  SKIP: CBECC data models not installed on this machine");
      checked = null;
    } else {
      console.error(out);
    }
  }
  if(checked !== null) ok("RULESET_SYSTEM_TYPES matches the installed Input Data Models", checked === true);

  // cleanup
  setYear(2025);
  [evap].forEach(s => { if(appDoc.records.indexOf(s) !== -1) deleteSystem(appDoc, s); });
  [strayCoil, legacy].forEach(r => { const i = appDoc.records.indexOf(r); if(i !== -1) appDoc.records.splice(i, 1); });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
