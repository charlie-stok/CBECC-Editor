#!/usr/bin/env node
//
// Generates the editor's per-code-year FIELD MODEL from CBECC's own "Input Data Model"
// dump, so nothing about a field's datatype, units, enum options, validation band or
// input class is transcribed by hand.
//
//   node tools/extract_field_model.js            # print the JS table to stdout
//   node tools/extract_field_model.js --check    # exit 1 if the editor disagrees
//
// This is the sibling of extract_ruleset_enums.js, which covers AirSys/ZnSys Type and
// SubType only. This one covers the objects the envelope / lighting / process-load /
// renewables steps edit. Same two ground rules apply:
//
//   SOURCE SELECTION MATTERS -- read each year from ITS OWN install. The 2025 install
//   also ships backward-compatibility copies of older enums, which are supersets, not
//   the older ruleset.
//
//   PARSE CONDITIONS, DON'T UNION THEM -- FenCons:CertificationMthd offers a different
//   set for every (AssmContext, FenType) pair, and FenCons:FenProdType a different set
//   per FenType. Merging them would offer values the ruleset rejects.
//
// Only whitelisted props are emitted. The full model is ~1500 props across 100+
// objects; embedding all of it would bloat the editor for no gain. Spc alone has 149
// inputs, of which these steps touch about 30.
//
// Deliberately excluded: IntLtgSys:AllowType. It is conditioned on ParentSpcFunc, so
// the ruleset spells out one branch per space function -- ~600 branches. The lighting
// step reports the value and leaves it alone rather than carrying that table.

const fs = require('fs');
const path = require('path');

const DATA_ROOT = process.env.CBECC_DATA_ROOT ||
  "C:/Users/CharlieChristenson/OneDrive - Stok LLC/Documents";

// One entry per code year, pointing at that year's OWN install.
const MODELS = {
  2022: "CBECC 2022 Data/Documents/RulesetSource/T24N_2022 - Input Data Model.txt",
  2025: "CBECC 2025 Data/Documents/RulesetSource/T24_2025 - Input Data Model.txt",
  // 2028 has no install of its own yet -- a year with no table means the editor
  // permits everything and says so, which is the right degradation.
};

// Object -> props to emit.
const WHITELIST = {
  // ---- Envelope: construction libraries ----
  ConsAssm: ["CompatibleSurfType", "FireRtdFlag", "SlabType", "SlabInsOrientation",
             "SlabInsThrmlR", "FieldAppliedCoating", "CRRCInitialRefl", "CRRCAgedRefl",
             "CRRCInitialEmit", "CRRCAgedEmit", "CRRCSRI", "RoofDens", "BuiltUpRoof",
             "BallastedRoof", "MatRef"],
  FenCons: ["FenType", "FenProdType", "AssmContext", "CertificationMthd", "SkyltGlz",
            "SkyltCurb", "OperableWinConfiguration", "GreenhouseGardenWin", "FenFrm",
            "FenPanes", "GlzTint", "WinDivider", "Diffusing", "SHGC", "SHGCCOG",
            "UFactor", "UFactorCOG", "VT", "VTCOG", "ShdgCred", "DynamicGlz"],
  DrCons:  ["Type", "CertificationMthd", "UFactor", "Open", "DrAutoCloser"],
  // ---- Envelope: surfaces ----
  ExtWall:   ["Status", "ConsAssmRef", "Area", "Az", "Tilt"],
  Roof:      ["Status", "ConsAssmRef", "Area", "Az", "Tilt"],
  ExtFlr:    ["Status", "ConsAssmRef", "Area"],
  UndgrWall: ["Status", "ConsAssmRef", "Area"],
  UndgrFlr:  ["Status", "ConsAssmRef", "Area"],
  IntWall:   ["Status", "ConsAssmRef", "Area", "AdjacentSpcRef"],
  IntFlr:    ["Status", "ConsAssmRef", "Area", "AdjacentSpcRef"],
  Ceiling:   ["Status", "ConsAssmRef", "Area", "AdjacentSpcRef"],
  Win:       ["Status", "FenConsRef", "Area", "Hgt", "Wd"],
  Dr:        ["Status", "DrConsRef", "FenConsRef", "Area", "Hgt", "Wd"],
  Skylt:     ["Status", "FenConsRef", "Area"],
  // ---- Lighting ----
  Lum:       ["FxtrType", "LampType", "Pwr", "LumDescRpt"],
  IntLtgSys: ["PwrReg", "NonRegExclusion", "LumRef", "LumCnt", "LumStatus"],
  // ---- Lighting + process loads, both on Spc ----
  Spc: ["LtgStatus", "IntLPDReg", "IntLPDNonReg",
        "RecptPwrDens", "RecptRadFrac", "RecptLatFrac", "RecptLostFrac",
        "ElecEqpPwrDens", "ElecEqpRadFrac", "ElecEqpLatFrac", "ElecEqpLostFrac",
        "GasEqpPwrDens", "GasEqpRadFrac", "GasEqpLatFrac", "GasEqpLostFrac",
        "ProcElecPwrDens", "ProcElecSchRef", "ProcElecRadFrac", "ProcElecLatFrac",
        "ProcElecLostFrac",
        "ProcGasPwrDens", "ProcGasSchRef", "ProcGasRadFrac", "ProcGasLatFrac",
        "ProcGasLostFrac",
        "ElevCnt", "ElevPwr", "EscalCnt", "EscalPwr"],
  // ---- Renewables ----
  PVArray: ["SpecMthd", "DCSysSize", "ModuleType", "CalFlexibleInstallOpt",
            "GeomSpecMthd", "LctnSpecMthd", "Az", "TiltInp", "TiltPitch", "TiltAngle",
            "ArrayType", "PwrElec", "SolarAccess", "InverterEff", "Hgt", "Wd",
            "RefX", "RefY", "RefZ"],
  Batt: ["SimStandaloneBatt", "MaxCap", "Ctrl", "StandaloneChgStartHr", "ChrgEff",
         "DschrgEff", "AllowBattRoundTripEff", "RoundTripEff", "NumRankedDays"],
};

const DATATYPES = ["Float", "Integer", "String", "Enumeration", "ObjectRef", "Date"];
const INPUT_CLASSES = ["Required", "Defaulted", "Optional", "Compulsory", "CondRequired"];

// The Input Data Model is an indented text dump:
//   <Object>  <LongName>  #Props:n/m                          <- column 0
//         <Prop>  <LongName>  <DataType>  [#Vals: n] [Units: u] <InputClass> [Error if not: ...]
//                        When:  <Prop> = "<Value>"             <- a conditional branch
//                         and:  <Prop> = "<Value>"             <- ...with extra terms
//                        else:
//                               default:  <id>
//                                     <id>:  "<Name>"
//                        <ObjectType>  (<filter>)              <- ObjectRef targets
function parseRange(text){
  // "0 <= Value <= 2.5" | "Value >= 0.1" | "Value <= 20"
  let m = text.match(/^\s*(-?[\d.]+)\s*<=\s*Value\s*<=\s*(-?[\d.]+)\s*$/);
  if(m) return {min: parseFloat(m[1]), max: parseFloat(m[2])};
  m = text.match(/^\s*Value\s*>=\s*(-?[\d.]+)\s*$/);
  if(m) return {min: parseFloat(m[1])};
  m = text.match(/^\s*Value\s*<=\s*(-?[\d.]+)\s*$/);
  if(m) return {max: parseFloat(m[1])};
  return null;
}

function parseModel(file){
  const lines = fs.readFileSync(file, 'latin1').split(/\r?\n/);
  const out = {};
  let obj = null, prop = null, field = null, branch = null;

  const startBranch = (when) => {
    branch = {when, def: null, syms: []};
    field.enums.push(branch);
  };

  for(const line of lines){
    const om = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s+\S.*#Props:/);
    if(om){ obj = WHITELIST[om[1]] ? om[1] : null; prop = null; field = null; branch = null; continue; }
    if(!obj) continue;

    const pm = line.match(/^ {6}([A-Za-z][A-Za-z0-9_]*)\s{2,}(.+?)\s{2,}(\S.*)$/);
    if(pm){
      prop = null; field = null; branch = null;
      if(WHITELIST[obj].indexOf(pm[1]) === -1) continue;
      const tail = pm[3];
      const dt = DATATYPES.find(d => tail.startsWith(d));
      if(!dt) continue;              // not a prop line after all
      prop = pm[1];
      field = {type: dt, long: pm[2].trim(), enums: []};

      const nv = tail.match(/#Vals:\s*(\d+)/);
      if(nv) field.nVals = parseInt(nv[1], 10);
      const un = tail.match(/Units:\s*(.+?)(?:\s{2,}|$)/);
      if(un) field.units = un[1].trim();
      const ic = INPUT_CLASSES.find(c => tail.indexOf(c + " input") !== -1);
      field.inputClass = ic || "Conditional";   // "(see next line)" -> prose condition

      const err = tail.match(/Error if not:\s*(.+?)(?:,\s*Warning if not:\s*(.+?))?\s*$/);
      if(err){
        const e = parseRange(err[1]); if(e) field.error = e;
        if(err[2]){ const w = parseRange(err[2]); if(w) field.warn = w; }
      } else {
        const wn = tail.match(/Warning if not:\s*(.+?)\s*$/);
        if(wn){ const w = parseRange(wn[1]); if(w) field.warn = w; }
      }

      (out[obj] = out[obj] || {})[prop] = field;
      continue;
    }
    if(!prop) continue;

    // A conditional branch: "When:" opens one, each following "and:" adds a term.
    const wm = line.match(/^\s+When:\s+(\S+)\s*=\s*(?:"(.*?)"|(-?\d+))\s*$/);
    if(wm){ startBranch([[wm[1], wm[2] !== undefined ? wm[2] : wm[3]]]); continue; }
    const am = line.match(/^\s+and:\s+(\S+)\s*=\s*(?:"(.*?)"|(-?\d+))\s*$/);
    if(am){
      if(branch && branch.when) branch.when.push([am[1], am[2] !== undefined ? am[2] : am[3]]);
      continue;
    }
    if(/^\s+else:\s*$/.test(line)){ startBranch(null); continue; }

    const dm = line.match(/^\s+default:\s+(-?\d+)\s*$/);
    if(dm){
      if(!branch) startBranch(null);          // unconditional enum
      branch.defaultId = parseInt(dm[1], 10);
      continue;
    }
    const sm = line.match(/^\s+(-?\d+):\s+"(.*)"\s*$/);
    if(sm){
      if(!branch) startBranch(null);
      branch.syms.push([parseInt(sm[1], 10), sm[2]]);
      continue;
    }

    // ObjectRef target list: a bare object name, optionally with a filter in parens.
    if(field.type === "ObjectRef"){
      const rm = line.match(/^\s{10,}([A-Z][A-Za-z0-9_]*)\s*(?:\((.+)\))?\s*$/);
      if(rm){
        field.refs = field.refs || [];
        const entry = {type: rm[1]};
        if(rm[2]){
          const f = rm[2].match(/([A-Za-z0-9_]+):([A-Za-z0-9_]+)\s*=\s*"(.*)"/);
          if(f) entry.filter = [f[1] + ":" + f[2], f[3]];
        }
        field.refs.push(entry);
      }
    }
  }
  return out;
}

// Resolve each branch's id list into the value names the .cibd file actually stores,
// and its declared default into a name. A default id the branch does not offer emits
// def:null rather than a guess -- the same quirk extract_ruleset_enums.js preserves.
function finalize(model){
  for(const obj of Object.keys(model)){
    for(const prop of Object.keys(model[obj])){
      const f = model[obj][prop];
      if(!f.enums.length){ delete f.enums; continue; }
      f.enums = f.enums.map(b => {
        const byId = new Map(b.syms);
        const vals = b.syms.map(s => s[1]);
        const def = (b.defaultId !== null && byId.has(b.defaultId)) ? byId.get(b.defaultId) : null;
        const o = {vals, def};
        if(b.when) o.when = b.when;
        return o;
      }).filter(b => b.vals.length);
      if(!f.enums.length) delete f.enums;
    }
  }
  return model;
}

function build(){
  const years = {};
  for(const [year, rel] of Object.entries(MODELS)){
    const file = path.join(DATA_ROOT, rel);
    if(!fs.existsSync(file)){
      console.error(`SKIP ${year}: not found -- ${file}`);
      continue;
    }
    years[year] = finalize(parseModel(file));
  }
  return years;
}

// Units carry non-ASCII (the degree sign in "Btu/h-degF-ft2"), and this table is
// pasted into an HTML file edited as bytes. Escape rather than rely on encoding.
function jsonAscii(v){
  return JSON.stringify(v).replace(/[\u0080-\uffff]/g,
    c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

// Emit one object per line so a diff points at the object that moved.
function emit(years){
  let out = "const FIELD_MODEL = {\n";
  for(const year of Object.keys(years).sort()){
    out += `  ${year}: {\n`;
    for(const obj of Object.keys(years[year]).sort()){
      out += `    ${obj}: ${jsonAscii(years[year][obj])},\n`;
    }
    out += "  },\n";
  }
  out += "};\n";
  return out;
}

const years = build();
const text = emit(years);

if(process.argv.indexOf('--check') !== -1){
  // The editor is CRLF; compare on normalized newlines so the whole table
  // does not read as one giant difference.
  const html = fs.readFileSync(path.join(__dirname, '..', 'CIBD_editor.html'), 'utf8').split("\r\n").join("\n");
  const start = html.indexOf('const FIELD_MODEL = {');
  if(start === -1){ console.error("FAIL: FIELD_MODEL not found in CIBD_editor.html"); process.exit(1); }
  const end = html.indexOf('\n};\n', start);
  const embedded = html.slice(start, end + 4);
  if(embedded.trim() === text.trim()){ console.log("OK: FIELD_MODEL matches the ruleset."); process.exit(0); }
  console.error("FAIL: FIELD_MODEL has drifted from the ruleset. Regenerate it.");
  // Point at the first object that differs, rather than dumping both copies.
  const a = embedded.trim().split('\n'), b = text.trim().split('\n');
  for(let i = 0; i < Math.max(a.length, b.length); i++){
    if(a[i] !== b[i]){
      console.error("  first difference, line " + (i + 1));
      console.error("  editor:  " + String(a[i]).slice(0, 160));
      console.error("  ruleset: " + String(b[i]).slice(0, 160));
      break;
    }
  }
  process.exit(1);
}

process.stdout.write(text);
