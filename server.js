"use strict";
/* Hestia Chat — static file server, NOL dependensi (http bawaan Node). */
var http = require("http");
var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, "public");
var PORT = parseInt(process.env.PORT || "3000", 10);

var TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function safeJoin(rel) {
  var p = path.normalize(path.join(ROOT, rel));
  return p.indexOf(ROOT) === 0 ? p : null;
}

var server = http.createServer(function (req, res) {
  try {
    var urlPath = decodeURIComponent(req.url.split("?")[0]);
    if (urlPath === "/") urlPath = "/index.html";
    var file = safeJoin(urlPath);
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(ROOT, "index.html"); // SPA fallback
    }
    var ext = path.extname(file).toLowerCase();
    res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("server error");
  }
});

server.listen(PORT, function () {
  console.log("Hestia Chat jalan di port " + PORT);
});
