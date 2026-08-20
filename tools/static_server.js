#!/usr/bin/env node
//
// Serves the repo over HTTP so CIBD_editor.html can be opened in a browser without
// Postgres. server.js is the real app -- it does accounts, saved projects and the
// database -- and it exits if it cannot reach Postgres. This is the standalone
// single-file mode of the editor, which is how it is used offline anyway: the page
// treats an http:// origin as server mode, so pass ?standalone=1 to keep it local,
// or just use it as a way to look at the UI while working on it.
//
//   node tools/static_server.js [port]

const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.argv[2]) || 3100;
const root = path.join(__dirname, '..');
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".cibd25": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if(rel === "/") rel = "/CIBD_editor.html";
  // The editor treats an http:// origin as server mode and bounces to the login page
  // when /api/auth/me does not answer. This answers it so the page stays put. It is
  // not authentication and grants nothing: no project, file or admin route exists
  // here, so there is nothing behind it to reach.
  if(rel === "/api/auth/me"){
    res.writeHead(200, {"Content-Type": "application/json"});
    res.end(JSON.stringify({email: "preview@localhost", note: "static preview, no database"}));
    return;
  }
  // Anything resolving outside the repo is refused rather than served.
  const file = path.resolve(path.join(root, rel));
  if(!file.startsWith(path.resolve(root))){ res.writeHead(403).end("forbidden"); return; }
  fs.readFile(file, (err, buf) => {
    if(err){ res.writeHead(404).end("not found"); return; }
    res.writeHead(200, {"Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream"});
    res.end(buf);
  });
}).listen(port, () => console.log("static preview on http://localhost:" + port + "/"));
