#!/usr/bin/env node
//
// Generates the editor's per-code-year system enum tables from CBECC's own ruleset
// dumps, so nothing about which Types and SubTypes a cycle allows is transcribed or
// inferred by hand.
//
//   node tools/extract_ruleset_enums.js            # print the JS tables to stdout
//   node tools/extract_ruleset_enums.js --check    # exit 1 if the editor disagrees
//
// SOURCE SELECTION MATTERS. Read each year from ITS OWN install. The 2025 install also
// ships "T24N_2022 BEMEnums.txt", but that file is a backward-compatibility superset,
// not the 2022 ruleset: it lists ZnSys EvaporativeCooler, which the 2022 install's own
// enum does not have. Generating 2022 from it silently breaks the year gating.
//
// PARSE CONDITIONS, DON'T UNION THEM. An earlier version of this script merged every
// "When:" branch into one list, which hid that AirSys:Type narrows to five types when
// AirSys:ServesResZn = 1. Branches are kept separate here.
//
// Two quirks in CBECC's own data, preserved rather than smoothed over:
//   - Some blocks declare a `default:` id that the block does not offer. AirSys:SubType
//     for Type=HV and Type=Exhaust declares default 5 (which is CRAC in that property's
//     numbering) while offering only id 7, "NA". Those emit def:null.
//   - ZnSys:SubType carries a condition on Type id 23, which is not a ZnSys:Type at
//     all. Dead conditions are dropped.

const fs = require('fs');
const path = require('path');

const DATA_ROOT = process.env.CBECC_DATA_ROOT ||
  "C:/Users/CharlieChristenson/OneDrive - Stok LLC/Documents";

// One entry per code year, pointing at that year's OWN install.
const MODELS = {
  2022: "CBECC 2022 Data/Documents/RulesetSource/T24N_2022 - Input Data Model.txt",
  2025: "CBECC 2025 Data/Documents/RulesetSource/T24_2025 - Input Data Model.txt",
  // 2028 has no install of its own yet. Omitted deliberately: the editor treats a year
  // with no table as "permit everything, and warn", which is the right degradation.
};

const OBJECTS = ['AirSys', 'ZnSys'];
const PROPS   = ['Type', 'SubType'];

// The Input Data Model is an indented text dump:
//   <Object>  <LongName>  #Props:n/m                   <- column 0
//         <Prop>  <LongName>  <DataType> ...           <- indented 6
//                        When:  <Prop> = "<Value>"     <- a conditional branch
//                        else:
//                               default:  <id>
//                                     <id>:  "<Name>"
function parseModel(file){
  const lines = fs.readFileSync(file, 'latin1').split(/\r?\n/);
  const objs = {};
  let obj = null, prop = null, branch = null;

  const startBranch = (o, p, key) => {
    if(!objs[o]) objs[o] = {};
    if(!objs[o][p]) objs[o][p] = [];
    branch = {key, defaultId: null, syms: []};
    objs[o][p].push(branch);
  };

  for(const line of lines){
    const om = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s+\S.*#Props:/);
    if(om){ obj = om[1]; prop = null; branch = null; continue; }
    if(!obj) continue;

    const pm = line.match(/^ {6}([A-Za-z][A-Za-z0-9_]*)\s{2,}\S/);
    if(pm){
      prop = PROPS.indexOf(pm[1]) !== -1 && OBJECTS.indexOf(obj) !== -1 ? pm[1] : null;
      branch = null;
      if(prop) startBranch(obj, prop, 'default');   // unconditional until a When: appears
      continue;
    }
    if(!prop) continue;

    const wm = line.match(/^\s+When:\s+(\S+)\s*=\s*(?:"(.*?)"|(-?\d+))\s*$/);
    if(wm){ startBranch(obj, prop, wm[1] + '=' + (wm[2] !== undefined ? wm[2] : wm[3])); continue; }
    if(/^\s+else:\s*$/.test(line)){ startBranch(obj, prop, 'default'); continue; }

    const dm = line.match(/^\s+default:\s+(-?\d+)\s*$/);
    if(dm && branch){ branch.defaultId = +dm[1]; continue; }

    const sm = line.match(/^\s+(-?\d+):\s+"(.*?)"\s*$/);
    if(sm && branch) branch.syms.push({id: +sm[1], name: sm[2]});
  }
  // Drop branches that carry no symbols (a property with no enum at all).
  for(const o of Object.keys(objs))
    for(const p of Object.keys(objs[o]))
      objs[o][p] = objs[o][p].filter(b => b.syms.length);
  return objs;
}

const isPlaceholder = n => /^- .* -$/.test(n);
const clean = syms => syms.map(s => s.name).filter(n => !isPlaceholder(n));

function typeSets(model, obj){
  const branches = (model[obj] && model[obj].Type) || [];
  const out = {};
  for(const b of branches){
    const names = clean(b.syms);
    if(!names.length) continue;
    if(out[b.key]) for(const n of names){ if(out[b.key].indexOf(n) === -1) out[b.key].push(n); }
    else out[b.key] = names;
  }
  return out;
}

// Per-Type SubType sets. Types with no branch of their own inherit the `else` branch,
// expanded here so the editor never has to work it out at runtime.
function subTypeSets(model, obj){
  const branches = (model[obj] && model[obj].SubType) || [];
  const allTypes = clean(((model[obj] && model[obj].Type) || []).flatMap(b => b.syms));
  const byType = {};
  let fallback = null;
  for(const b of branches){
    const vals = clean(b.syms);
    if(!vals.length) continue;
    const hit = b.syms.find(s => s.id === b.defaultId);
    const entry = {vals, def: hit && !isPlaceholder(hit.name) ? hit.name : null};
    if(b.key === 'default'){ fallback = entry; continue; }
    const m = b.key.match(/^(.*):Type=(.*)$/);
    if(!m || m[1] !== obj) continue;                 // conditioned on something else
    if(allTypes.indexOf(m[2]) === -1) continue;       // dead condition (e.g. ZnSys id 23)
    byType[m[2]] = entry;
  }
  if(fallback) for(const t of allTypes) if(!byType[t]) byType[t] = fallback;
  return byType;
}

function collect(){
  const out = {};
  for(const [year, rel] of Object.entries(MODELS)){
    const file = path.join(DATA_ROOT, rel);
    if(!fs.existsSync(file)){ console.error(`# skipped ${year}: not found at ${file}`); continue; }
    const model = parseModel(file);
    out[year] = {types: {}, subTypes: {}};
    for(const obj of OBJECTS){
      out[year].types[obj]    = typeSets(model, obj);
      out[year].subTypes[obj] = subTypeSets(model, obj);
    }
  }
  return out;
}

function emit(data){
  const L = [];
  L.push('// GENERATED by tools/extract_ruleset_enums.js -- do not edit by hand.');
  L.push('// Source: each code year\'s OWN "Input Data Model.txt", from that year\'s CBECC');
  L.push('// install. Regenerate after any ruleset update; test_code_year.js re-derives these');
  L.push('// and fails if they have drifted.');
  L.push('//');
  L.push('// types.<family>.default is the general Type list. Any other key is a conditional');
  L.push('// narrowing taken verbatim from the ruleset -- "AirSys:ServesResZn=1" is the five');
  L.push('// types CBECC offers a system that serves residential zones.');
  L.push('// subTypes.<family>.<Type> is that Type\'s SubType set and its default. Types with');
  L.push('// no branch of their own are already expanded to the ruleset\'s else-branch, so');
  L.push('// nothing is inferred at runtime. def:null means the ruleset declared a default it');
  L.push('// does not actually offer (true of AirSys HV and Exhaust).');
  L.push('const RULESET_ENUMS = {');
  for(const y of Object.keys(data).sort()){
    const d = data[y];
    L.push(`  ${y}: {`);
    for(const section of ['types', 'subTypes']){
      L.push(`    ${section}: {`);
      for(const fam of OBJECTS){
        L.push(`      ${fam}: {`);
        const rows = Object.entries(d[section][fam]).sort();
        for(const [k, v] of rows){
          L.push(`        ${JSON.stringify(k)}: ${section === 'types'
            ? JSON.stringify(v)
            : `{vals: ${JSON.stringify(v.vals)}, def: ${JSON.stringify(v.def)}}`},`);
        }
        L.push('      },');
      }
      L.push('    },');
    }
    L.push('  },');
  }
  L.push('};');
  return L.join('\n');
}

function check(data){
  const src = fs.readFileSync(path.join(__dirname, '..', 'CIBD_editor.html'), 'utf8');
  const m = src.match(/const RULESET_ENUMS = (\{[\s\S]*?\n\});/);
  if(!m){ console.error('FAIL: RULESET_ENUMS not found in CIBD_editor.html'); process.exit(1); }
  let inEditor;
  try { inEditor = eval('(' + m[1] + ')'); }
  catch(err){ console.error('FAIL: RULESET_ENUMS did not parse:', err.message); process.exit(1); }

  let bad = 0;
  const fail = msg => { console.error('FAIL ' + msg); bad++; };
  for(const [y, d] of Object.entries(data)){
    const got = inEditor[y];
    if(!got){ fail(`${y}: missing from the editor`); continue; }
    for(const fam of OBJECTS){
      for(const [k, want] of Object.entries(d.types[fam])){
        const have = (got.types && got.types[fam] && got.types[fam][k]) || [];
        if(JSON.stringify(have) !== JSON.stringify(want))
          fail(`${y} types.${fam}.${k}:\n     have ${JSON.stringify(have)}\n     want ${JSON.stringify(want)}`);
      }
      for(const [t, want] of Object.entries(d.subTypes[fam])){
        const have = (got.subTypes && got.subTypes[fam] && got.subTypes[fam][t]) || null;
        if(!have){ fail(`${y} subTypes.${fam}.${t}: missing`); continue; }
        if(JSON.stringify(have.vals) !== JSON.stringify(want.vals) || have.def !== want.def)
          fail(`${y} subTypes.${fam}.${t}:\n     have ${JSON.stringify(have)}\n     want ${JSON.stringify(want)}`);
      }
    }
  }
  if(bad){ console.error(`\n${bad} mismatch(es) -- regenerate with: node tools/extract_ruleset_enums.js`); process.exit(1); }
  console.log(`OK: editor tables match the installed rulesets (${Object.keys(data).join(', ')})`);
}

const data = collect();
if(Object.keys(data).length === 0){
  console.error('No data models found. Set CBECC_DATA_ROOT to the folder containing the "CBECC <year> Data" directories.');
  process.exit(2);
}
if(process.argv.includes('--check')) check(data); else console.log(emit(data));
