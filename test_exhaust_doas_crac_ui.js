// DOM-level test: renders the two step forms that gained controls and asserts the
// new fields actually appear, respond to the type/subtype selects, and write through
// to the underlying records. Complements test_exhaust_doas_crac.js, which covers the
// data layer.

const { win, doc_, loadFile } = require('./run_full.js');

const testFile = "C:/Users/CharlieChristenson/OneDrive - Stok LLC/Documents/CBECC 2025 Projects/StandardModelTests/040012-OffLrg-CECStd.cibd25";

async function run(){
  let pass = 0, fail = 0;
  function ok(label, cond){ if(cond){ console.log("  PASS:", label); pass++; } else { console.error("  FAIL:", label); fail++; } }

  await loadFile(testFile);

  const e = expr => win.eval(expr);
  const appDoc = e('doc');
  const { createSystem, buildSystemComponents, getOrCreateThrmlZn,
          assignZoneToDOAS, setPlainAttr, deleteSystem } = win;

  const host = doc_.createElement('div');
  doc_.body.appendChild(host);
  function fire(el, type){ el.dispatchEvent(new win.Event(type, {bubbles: true})); }

  // ---- Step "Create HVAC systems" -----------------------------------------
  console.log("\n[1] Create-system form");
  win.renderHVACSystemsForm(host);
  const typeSel = host.querySelector('#sysTypeSelect');
  const values = Array.from(typeSel.options).map(o => o.value);
  ok("option values carry the family", values.indexOf('Exhaust|AirSys') !== -1 && values.indexOf('Exhaust|ZnSys') !== -1);
  ok("both exhaust entries are listed separately",
     Array.from(typeSel.options).filter(o => o.value.indexOf('Exhaust|') === 0).length === 2);

  // Create a zone-level exhaust fan through the form itself.
  host.querySelector('#sysNameInput').value = 'UI ZoneExh';
  typeSel.value = 'Exhaust|ZnSys';
  fire(typeSel, 'change');
  host.querySelector('#sysCreateResult').parentElement.querySelector('button.primary').click();
  const uiZoneExh = appDoc.records.find(r => r.name === 'UI ZoneExh');
  ok("form created a ZnSys, not an AirSys", uiZoneExh && uiZoneExh.type === 'ZnSys');

  // ---- Edit form: exhaust properties ---------------------------------------
  console.log("\n[2] Edit form exposes exhaust properties");
  const editBtn = Array.from(host.querySelectorAll('button[data-edit]'))
    .find(b => b.dataset.edit === 'UI ZoneExh');
  editBtn.click();
  const sn = 'UI_ZoneExh';
  const exhTypeEl = host.querySelector('#eset_' + sn);
  const exhCtlEl  = host.querySelector('#esec_' + sn);
  const exhModEl  = host.querySelector('#esem_' + sn);
  const subEl     = host.querySelector('#esst_' + sn);
  ok("Exh type select rendered and visible", exhTypeEl && exhTypeEl.style.display !== 'none');
  ok("Oper mode select rendered", !!exhModEl);
  ok("Fan control select rendered", !!exhCtlEl);
  ok("SubType row hidden for an exhaust system", subEl && subEl.style.display === 'none');
  ok("Fan control lists the General methods by default",
     Array.from(exhCtlEl.options).map(o => o.value).indexOf('ConstantFlowConstantSpeedFan') !== -1);

  // ExhCtrlMthd's valid set is conditioned on ExhSysType; ParkingGarage swaps it
  // to the CO-control pair.
  exhTypeEl.value = 'ParkingGarage';
  fire(exhTypeEl, 'change');
  const pgOpts = Array.from(host.querySelector('#esec_' + sn).options).map(o => o.value);
  ok("ParkingGarage swaps fan control to CO options",
     pgOpts.length === 2 && pgOpts.indexOf('COControl') !== -1 && pgOpts.indexOf('NoCOControl') !== -1);

  host.querySelector('#esec_' + sn).value = 'COControl';
  exhModEl.value = 'CoupledToSystem';
  Array.from(host.querySelectorAll('button[data-save]')).find(b => b.dataset.save === 'UI ZoneExh').click();
  ok("ExhSysType saved to the record", uiZoneExh.attrs.ExhSysType === 'ParkingGarage');
  ok("ExhCtrlMthd saved to the record", uiZoneExh.attrs.ExhCtrlMthd === 'COControl');
  ok("ExhOperMode saved to the record", uiZoneExh.attrs.ExhOperMode === 'CoupledToSystem');

  // ---- Edit form: SubType and the CRAC Config row --------------------------
  console.log("\n[3] Edit form exposes SubType and the CRAC-only Config row");
  const szvav = createSystem(appDoc, 'SZVAVAC', 'UI CRAC', 'AirSys');
  buildSystemComponents(appDoc, szvav);
  win.renderHVACSystemsForm(host);
  Array.from(host.querySelectorAll('button[data-edit]')).find(b => b.dataset.edit === 'UI CRAC').click();
  const sn2 = 'UI_CRAC';
  const subEl2 = host.querySelector('#esst_' + sn2);
  const cfgEl2 = host.querySelector('#escf_' + sn2);
  ok("SubType select visible for SZVAVAC", subEl2 && subEl2.style.display !== 'none');
  ok("SubType lists CRAC and CRAH",
     Array.from(subEl2.options).map(o => o.value).indexOf('CRAC') !== -1 &&
     Array.from(subEl2.options).map(o => o.value).indexOf('CRAH') !== -1);
  ok("blank 'CBECC default' row is selected when SubType is unset", subEl2.value === '');
  ok("Config row hidden while SubType is not CRAC", cfgEl2.style.display === 'none');
  subEl2.value = 'CRAC';
  fire(subEl2, 'change');
  ok("Config row appears when SubType becomes CRAC", host.querySelector('#escf_' + sn2).style.display !== 'none');
  ok("Exhaust rows stay hidden on a non-exhaust type", host.querySelector('#eset_' + sn2).style.display === 'none');

  host.querySelector('#escf_' + sn2).value = 'Ceiling-Mounted (Ducted Discharge and Ducted Return)';
  Array.from(host.querySelectorAll('button[data-save]')).find(b => b.dataset.save === 'UI CRAC').click();
  ok("SubType saved", szvav.attrs.SubType === 'CRAC');
  ok("Config saved", szvav.attrs.Config === 'Ceiling-Mounted (Ducted Discharge and Ducted Return)');

  // Clearing SubType back to the default must clear Config with it.
  Array.from(host.querySelectorAll('button[data-edit]')).find(b => b.dataset.edit === 'UI CRAC').click();
  host.querySelector('#esst_' + sn2).value = '';
  fire(host.querySelector('#esst_' + sn2), 'change');
  Array.from(host.querySelectorAll('button[data-save]')).find(b => b.dataset.save === 'UI CRAC').click();
  ok("SubType cleared back to CBECC default", szvav.attrs.SubType === undefined);
  ok("Config cleared with it", szvav.attrs.Config === undefined);

  // ---- Computer Room advisory renders --------------------------------------
  console.log("\n[4] Computer Room advisory renders in the list");
  const crZone = getOrCreateThrmlZn(appDoc, 'UI CompRm Zone');
  win.assignZoneToSystem(appDoc, crZone, szvav);
  const spc = appDoc.records.find(r => r.type === 'Spc');
  setPlainAttr(spc, 'ThrmlZnRef', 'UI CompRm Zone');
  setPlainAttr(spc, 'SpcFunc', 'Computer Room');
  win.renderHVACSystemsForm(host);
  ok("advisory text is in the rendered list", host.textContent.indexOf('set SubType CRAC/CRAH') !== -1);
  setPlainAttr(szvav, 'SubType', 'CRAH');
  win.renderHVACSystemsForm(host);
  ok("advisory clears once SubType is CRAH", host.textContent.indexOf('set SubType CRAC/CRAH') === -1);

  // ---- DOAS zone sizing panel ----------------------------------------------
  console.log("\n[5] DOAS tab renders per-zone sizing controls");
  const doasSys = createSystem(appDoc, 'DOASCV', 'UI DOAS', 'AirSys');
  buildSystemComponents(appDoc, doasSys);
  const dz1 = getOrCreateThrmlZn(appDoc, 'UI DOAS Zone 1');
  const dz2 = getOrCreateThrmlZn(appDoc, 'UI DOAS Zone 2');
  assignZoneToDOAS(appDoc, dz1, doasSys);
  assignZoneToDOAS(appDoc, dz2, doasSys);

  const host2 = doc_.createElement('div');
  doc_.body.appendChild(host2);
  win.renderThermalZoneForm(host2);
  const doasTab = Array.from(host2.querySelectorAll('button[data-tab-id]'))
    .find(b => b.dataset.tabId === 'doas');
  doasTab.click();
  ok("sizing panel heading rendered", host2.textContent.indexOf('Zone sizing for DOAS') !== -1);

  const grid = host2.querySelector('[data-doas-sizing="UI DOAS"]');
  ok("sizing grid rendered for the DOAS system", !!grid);
  const field = (name, zoneName) =>
    grid.querySelector('[data-doas-field="' + name + '"][data-doas-zone="' + zoneName + '"]');

  const chk1  = field('size', 'UI DOAS Zone 1');
  const ctrl1 = field('ctrl', 'UI DOAS Zone 1');
  const lo1   = field('lo',   'UI DOAS Zone 1');
  ok("a sizing row exists per assigned zone",
     !!chk1 && !!field('size', 'UI DOAS Zone 2'));
  ok("control select offers the ruleset enum verbatim",
     Array.from(ctrl1.options).map(o => o.value).indexOf('NeutralDehumidifed') !== -1);
  ok("controls start disabled while sizing is off", ctrl1.disabled === true);
  ok("nothing written to the zone until sizing is switched on", dz1.attrs.SizeForDOAS === undefined);

  chk1.checked = true;
  fire(chk1, 'change');
  ok("SizeForDOAS written when switched on", String(dz1.attrs.SizeForDOAS) === '1');
  ok("control select enabled once sizing is on", ctrl1.disabled === false);
  ctrl1.value = 'Cold';
  fire(ctrl1, 'change');
  ok("SizeForDOASCtrl written", dz1.attrs.SizeForDOASCtrl === 'Cold');

  lo1.value = '95';                                // outside the 50-90 warning band
  fire(lo1, 'change');
  ok("out-of-band temperature written", Number(dz1.attrs.SizeForDOASTempLow) === 95);
  ok("out-of-band temperature flagged", lo1.style.borderColor === 'var(--edited)');
  lo1.value = '62';
  fire(lo1, 'change');
  ok("in-band temperature clears the flag", lo1.style.borderColor === 'var(--border)');

  const copyBtn = Array.from(host2.querySelectorAll('button'))
    .find(b => b.textContent === 'Copy first row to all');
  copyBtn.click();
  ok("copy-to-all propagates SizeForDOAS", String(dz2.attrs.SizeForDOAS) === '1');
  ok("copy-to-all propagates the control", dz2.attrs.SizeForDOASCtrl === 'Cold');
  ok("copy-to-all propagates the temperature", Number(dz2.attrs.SizeForDOASTempLow) === 62);

  chk1.checked = false;
  fire(chk1, 'change');
  ok("switching sizing off removes all four fields",
     dz1.attrs.SizeForDOAS === undefined && dz1.attrs.SizeForDOASCtrl === undefined &&
     dz1.attrs.SizeForDOASTempLow === undefined && dz1.attrs.SizeForDOASTempHi === undefined);

  [uiZoneExh, szvav, doasSys].forEach(s => { if(appDoc.records.indexOf(s) !== -1) deleteSystem(appDoc, s); });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
