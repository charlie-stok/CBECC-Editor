#!/usr/bin/env node
//
// Generates the editor's per-code-year internal-load defaults from CBECC's own
// Appendix 5.4A space-by-space table, so lighting power density and plug/process
// load defaults are read from the ruleset rather than transcribed from the Standard.
//
//   node tools/extract_load_defaults.js            # print the JS table to stdout
//   node tools/extract_load_defaults.js --check    # exit 1 if the editor disagrees,
//                                                   and cross-check the overlap with
//                                                   the existing SPCFUNC_DEFAULTS_54A
//
// Each year is read from ITS OWN install -- the 2025 install also ships the 2013,
// 2016, 2019 and 2022 copies of this table, and a "- Copy"/"-xlsx" pair of the 2022
// one, none of which are that year's authority.
//
// Columns taken: IntLPDReg (regulated interior LPD, W/ft2 -- the space-level lighting
// default), RecptPwrDens, GasEqpPwrDens, CommRfrgEPD. Everything else in the table is
// either already covered by SPCFUNC_DEFAULTS_54A / VENTFUNC_DEFAULTS_54C or is a
// lighting allowance adder, which the editor reports but does not default.

const fs = require('fs');
const path = require('path');

const DATA_ROOT = process.env.CBECC_DATA_ROOT ||
  "C:/Users/CharlieChristenson/OneDrive - Stok LLC/Documents";

const TABLES = {
  2022: "CBECC 2022 Data/Documents/RulesetSource/T24N/Rules/Tables/App5-4A_SpaceBySpace-T24N_2022.csv",
  2025: "CBECC 2025 Data/Documents/RulesetSource/T24N/Rules/Tables/App5-4A_SpaceBySpace-T24N_2025.csv",
};

// Column header -> emitted key.
const WANT = {
  IntLPDReg:     "intLPDReg",
  RecptPwrDens:  "recptPwrDens",
  GasEqpPwrDens: "gasEqpPwrDens",
  CommRfrgEPD:   "commRfrgEPD",
};

// Minimal CSV split -- the table quotes any field containing a comma
// (e.g. "Aging Eye/Low-vision (Lobby, Main Entry)") and uses no escaped quotes.
function splitCsv(line){
  const out = [];
  let cur = "", inQ = false;
  for(const ch of line){
    if(ch === '"'){ inQ = !inQ; continue; }
    if(ch === ',' && !inQ){ out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseTable(file){
  const lines = fs.readFileSync(file, 'latin1').split(/\r?\n/);
  let header = null;
  const rows = {};
  for(const line of lines){
    if(/^ENDTABLE/.test(line)) break;
    const cells = splitCsv(line);
    if(!header){
      // The header row is the one carrying FuncType.
      if(cells.indexOf("FuncType") !== -1) header = cells.map(c => c.trim());
      continue;
    }
    const nameIdx = header.indexOf("FuncType");
    const name = cells[nameIdx] !== undefined ? cells[nameIdx].trim() : "";
    if(!name || name.startsWith("//")) continue;   // units row, comment rows
    const row = {};
    let any = false;
    for(const [col, key] of Object.entries(WANT)){
      const i = header.indexOf(col);
      if(i === -1) continue;                       // column absent in this cycle
      const raw = (cells[i] || "").trim();
      if(raw === "") continue;
      const v = parseFloat(raw);
      if(!Number.isFinite(v)) continue;
      row[key] = v; any = true;
    }
    if(any) rows[name] = row;
  }
  if(!header) throw new Error("no FuncType header row in " + file);
  return rows;
}

function build(){
  const years = {};
  for(const [year, rel] of Object.entries(TABLES)){
    const file = path.join(DATA_ROOT, rel);
    if(!fs.existsSync(file)){ console.error(`SKIP ${year}: not found -- ${file}`); continue; }
    years[year] = parseTable(file);
  }
  return years;
}

function emit(years){
  let out = "const LOAD_DEFAULTS_54A = {\n";
  for(const year of Object.keys(years).sort()){
    out += `  ${year}: {\n`;
    for(const name of Object.keys(years[year])){
      out += `    ${JSON.stringify(name)}: ${JSON.stringify(years[year][name])},\n`;
    }
    out += "  },\n";
  }
  out += "};\n";
  return out;
}

const years = build();
const text = emit(years);

if(process.argv.indexOf('--check') !== -1){
  const htmlPath = path.join(__dirname, '..', 'CIBD_editor.html');
  // The editor is CRLF; compare on normalized newlines.
  const html = fs.readFileSync(htmlPath, 'utf8').split("\r\n").join("\n");
  let bad = false;

  const start = html.indexOf('const LOAD_DEFAULTS_54A = {');
  if(start === -1){ console.error("FAIL: LOAD_DEFAULTS_54A not found in CIBD_editor.html"); process.exit(1); }
  const end = html.indexOf('\n};\n', start);
  const embedded = html.slice(start, end + 4);
  if(embedded.trim() === text.trim()){
    console.log("OK: LOAD_DEFAULTS_54A matches the ruleset.");
  } else {
    console.error("FAIL: LOAD_DEFAULTS_54A has drifted from the ruleset. Regenerate it.");
    const a = embedded.trim().split('\n'), b = text.trim().split('\n');
    for(let i = 0; i < Math.max(a.length, b.length); i++){
      if(a[i] !== b[i]){
        console.error("  first difference, line " + (i + 1));
        console.error("  editor:  " + String(a[i]).slice(0, 200));
        console.error("  ruleset: " + String(b[i]).slice(0, 200));
        break;
      }
    }
    bad = true;
  }

  // Cross-check: RecptPwrDens and GasEqpPwrDens also live in the hand-built
  // SPCFUNC_DEFAULTS_54A tables the occupancy step uses. If the two disagree, one of
  // them is wrong -- worth failing over, since both write the same file fields.
  const sandbox = {};
  for(const [name, year] of [["SPCFUNC_DEFAULTS_54A_2022", 2022], ["SPCFUNC_DEFAULTS_54A", 2025]]){
    const s = html.indexOf("const " + name + " = {");
    if(s === -1) continue;
    const e = html.indexOf("};\n", s);
    // eslint-disable-next-line no-eval
    eval(html.slice(s, e + 2).replace("const " + name, "sandbox['" + name + "']"));
    const occ = sandbox[name];
    const load = years[year] || {};
    let mismatches = 0;
    for(const func of Object.keys(occ)){
      const l = load[func];
      if(!l) continue;
      for(const [k, occKey] of [["recptPwrDens", "recptPwrDens"], ["gasEqpPwrDens", "gasEqpPwrDens"]]){
        if(l[k] === undefined) continue;
        if(Math.abs(l[k] - occ[func][occKey]) > 1e-6){
          console.error(`  MISMATCH ${year} "${func}" ${k}: 5.4A=${l[k]} occupancy table=${occ[func][occKey]}`);
          mismatches++;
        }
      }
    }
    if(mismatches){ console.error(`FAIL: ${mismatches} disagreement(s) between ${name} and 5.4A ${year}.`); bad = true; }
    else console.log(`OK: ${name} agrees with 5.4A ${year} on the shared columns.`);
  }
  process.exit(bad ? 1 : 0);
}

process.stdout.write(text);
