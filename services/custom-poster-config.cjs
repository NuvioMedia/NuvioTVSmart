"use strict";
var http = require("http");
var session = null;
var listener = null;
var expiry = null;
function escape(value) {
  return String(value || "").replace(/[&<>"']/g, function (char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}
function reply(response, status, body, html) {
  response.writeHead(status, {
    "Content-Type": html ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-" +
      (session ? session.token : "") +
      "'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'"
  });
  response.end(html ? body : JSON.stringify(body));
}
function stop(token) {
  if (!session || token !== session.token) return false;
  clearTimeout(expiry);
  expiry = null;
  session = null;
  if (listener) listener.close();
  listener = null;
  return true;
}
function renew() {
  clearTimeout(expiry);
  var token = session.token;
  expiry = setTimeout(function () {
    stop(token);
  }, 60000);
  if (expiry.unref) expiry.unref();
}
function scriptValue(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
function page(current) {
  var labels = current.labels;
  function label(key) {
    return escape(labels[key] || key);
  }
  return (
    '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    label("title") +
    "</title><style>body{margin:0;padding:24px;background:#101114;color:#eee;font:18px system-ui}main{max-width:680px;margin:auto}textarea{box-sizing:border-box;width:100%;min-height:150px;background:#222;color:white;padding:14px;font:16px monospace;border:1px solid #888;border-radius:10px}button{margin:12px 12px 0 0;padding:14px 24px;font:inherit;border-radius:10px}p{line-height:1.5;overflow-wrap:anywhere}</style><main><h1>" +
    label("title") +
    "</h1><p>" +
    label("subtitle") +
    '</p><label for="pattern">' +
    label("label") +
    '</label><textarea id="pattern" spellcheck="false"></textarea><button id="save">' +
    label("save") +
    '</button><button id="clear">' +
    label("clear") +
    '</button><p id="status" role="status"></p><p>' +
    label("info") +
    '</p></main><script nonce="' +
    current.token +
    '">(function(){var field=document.getElementById("pattern"),status=document.getElementById("status");function api(action,body){return fetch("api/"+action,{method:body?"POST":"GET",headers:{"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined}).then(function(r){if(!r.ok)throw Error();return r.json()})}api("pattern").then(function(v){field.value=v.pattern});function update(clear){api(clear?"clear":"pattern",clear?{}:{pattern:field.value}).then(function(){if(clear)field.value="";status.textContent=clear?' +
    scriptValue(labels.cleared || "Cleared") +
    ":" +
    scriptValue(labels.saved || "Saved!") +
    "}).catch(function(){status.textContent=" +
    scriptValue(labels.error || "Connection error") +
    '})}document.getElementById("save").onclick=function(){update(false)};document.getElementById("clear").onclick=function(){update(true)}})();</script></html>'
  );
}
function handle(request, response) {
  var current = session;
  if (!current) return reply(response, 404, { error: "Expired" });
  var prefix = "/" + current.token + "/";
  var route = String(request.url || "").split("?")[0];
  if (route.indexOf(prefix) !== 0) return reply(response, 404, { error: "Not found" });
  if (request.headers.origin && request.headers.origin !== "http://" + request.headers.host)
    return reply(response, 403, { error: "Origin" });
  route = route.slice(prefix.length);
  if (request.method === "GET" && route === "") return reply(response, 200, page(current), true);
  if (request.method === "GET" && route === "api/pattern")
    return reply(response, 200, { pattern: current.pattern });
  if (request.method !== "POST" || ["api/pattern", "api/clear"].indexOf(route) < 0)
    return reply(response, 404, { error: "Not found" });
  var size = 0,
    chunks = [];
  request.on("data", function (chunk) {
    size += chunk.length;
    if (size <= 16384) chunks.push(chunk);
  });
  request.on("end", function () {
    if (session !== current) return reply(response, 410, { error: "Expired" });
    if (size > 16384) return reply(response, 413, { error: "Too large" });
    try {
      var body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      var pattern =
        route === "api/clear" ? "" : typeof body.pattern === "string" ? body.pattern.trim() : null;
      if (pattern === null || pattern.length > 8192 || (pattern && !/^https?:\/\//i.test(pattern)))
        return reply(response, 400, { error: "Invalid pattern" });
      current.pattern = pattern;
      current.revision += 1;
      current.cleared = route === "api/clear";
      reply(response, 200, { status: current.cleared ? "cleared" : "saved" });
    } catch (_) {
      reply(response, 400, { error: "Invalid JSON" });
    }
  });
  request.on("error", function () {});
}
function start(payload) {
  if (!/^[a-f0-9]{64}$/.test(payload.token || ""))
    return Promise.reject(new Error("Invalid token"));
  if (typeof payload.pattern !== "string" || payload.pattern.length > 8192)
    return Promise.reject(new Error("Invalid pattern"));
  if (session) stop(session.token);
  var current = {
    token: payload.token,
    pattern: payload.pattern,
    labels: {},
    revision: 0,
    cleared: false
  };
  Object.keys(payload.labels || {})
    .slice(0, 20)
    .forEach(function (key) {
      current.labels[key] = String(payload.labels[key]).slice(0, 4096);
    });
  session = current;
  return new Promise(function (resolve, reject) {
    function bind(port) {
      var server = http.createServer(handle);
      server.maxConnections = 8;
      server.setTimeout(15000);
      server.requestTimeout = 15000;
      server.headersTimeout = 10000;
      server.once("error", function (error) {
        if (session !== current) return reject(new Error("Superseded"));
        if (error.code === "EADDRINUSE" && port < 8101) return bind(port + 1);
        stop(current.token);
        reject(error);
      });
      server.listen(port, "0.0.0.0", function () {
        if (session !== current) {
          server.close();
          return reject(new Error("Superseded"));
        }
        listener = server;
        renew();
        var address = "";
        try {
          var interfaces = require("os").networkInterfaces();
          Object.keys(interfaces).some(function (name) {
            return interfaces[name].some(function (entry) {
              if (!entry.internal && (entry.family === "IPv4" || entry.family === 4)) {
                address = entry.address;
                return true;
              }
              return false;
            });
          });
        } catch (_) {}
        resolve({ port: port, address: address, revision: 0 });
      });
    }
    bind(8092);
  });
}
module.exports = {
  start: start,
  stop: stop,
  stopAll: function () {
    return session ? stop(session.token) : false;
  },
  read: function (token) {
    if (!session || session.token !== token) return null;
    renew();
    return { pattern: session.pattern, revision: session.revision, cleared: session.cleared };
  }
};
