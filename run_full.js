const { JSDOM } = require('jsdom');
const fs = require('fs');
let html = fs.readFileSync('CIBD_editor.html', 'utf8');
html = html.replace(/<script src="https:[^"]*"><\/script>/g, '');
html = html.replace('</head>', '<script>window.__IS_TEST__=true;</script></head>');
html = html.replace(/<link[^>]*fonts\.googleapis[^>]*>/g, '');
html = html.replace(/<link[^>]*fonts\.gstatic[^>]*>/g, '');
const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost:3000' });
global.__testDocument = dom.window.document;
require('./three_stub.js');
dom.window.THREE = global.THREE;
dom.window.alert = () => {};
dom.window.requestAnimationFrame = () => {};

const win = dom.window;
const doc_ = win.document;

function loadFile(filename){
  return new Promise((resolve) => {
    const fileContent = fs.readFileSync(filename, 'utf8');
    const fileInput = doc_.getElementById('fileInput');
    Object.defineProperty(fileInput, 'files', { value: [{name: filename}], configurable: true });
    win.FileReader = function(){ this.readAsText = () => { this.onload({ target: { result: fileContent } }); }; };
    fileInput.dispatchEvent(new win.Event('change'));
    setTimeout(resolve, 50);
  });
}

function clickStepByTitle(titleText){
  const rows = Array.from(doc_.querySelectorAll('.step-row'));
  const row = rows.find(r => r.textContent.includes(titleText));
  if(!row) throw new Error('step not found: ' + titleText);
  row.dispatchEvent(new win.Event('click', {bubbles:true}));
}

module.exports = { dom, win, doc_, loadFile, clickStepByTitle };
