/* Local server for Nuvio on Hisense VIDAA.
 *
 * VIDAA's browser gives file:// pages no network access, so the app is served
 * over http, by the TV's own Node (phoenix), on 127.0.0.1 only.
 *
 *   phoenix serve.cjs [homeDir] [port]
 *
 * Besides the static files it:
 *   - starts the torrent engine (engine.cjs, the EngineFS runtime on
 *     127.0.0.1:2710) when the app asks for it with POST /__nuvio/engine/start,
 *     and stops it again after it has had no torrents for ENGINE_IDLE_MS, so it
 *     only holds memory while it is used;
 *   - appends client error reports (POST /__log) to a small log in /tmp.
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const HOME = path.resolve(process.argv[2] || __dirname);
const ROOT = path.join(HOME, "www");
const PORT = Number(process.argv[3] || 8100);

const ENGINE_PORT = 2710;
const ENGINE_LOG = "/tmp/nuvio-engine.log";
const ENGINE_IDLE_MS = 20 * 60 * 1000;
const ENGINE_CHECK_MS = 60 * 1000;

// Add-on URLs waiting to be installed by the app (js/platform/vidaa/vidaaAddonInbox.js).
// A JSON array of URLs; it survives restarts until the app has taken them.
const ADDON_INBOX = "/var/local/nuvio-addon-inbox.json";

const CLIENT_LOG = "/tmp/nuvio-client.log";
const LOG_MAX = 256 * 1024;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8"
};

const log = (msg) => console.log(new Date().toISOString() + " " + msg);

const rotate = (file) => {
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > LOG_MAX) fs.renameSync(file, file + ".1");
  } catch (_) {}
};

const readBody = (req, limit, done) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > limit) req.destroy();
  });
  req.on("end", () => done(body));
};

// ---- torrent engine -------------------------------------------------------

let engine = null;
let engineIdleSince = 0;

const engineGet = (p, timeoutMs = 2000) =>
  new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: ENGINE_PORT, path: p }, (res) => {
      let body = "";
      res.on("data", (c) => {
        body += c;
      });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", () => resolve(null));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(null);
    });
  });

const startEngine = async () => {
  if (engine && engine.exitCode === null) return "running";
  if (await engineGet("/settings")) return "running";
  rotate(ENGINE_LOG);
  let out = "ignore";
  try {
    out = fs.openSync(ENGINE_LOG, "a");
  } catch (_) {}
  engine = spawn(
    process.execPath,
    [
      "--require",
      path.join(HOME, "engine", "localhost-only.cjs"),
      path.join(HOME, "engine", "engine.cjs")
    ],
    {
      cwd: path.join(HOME, "engine"),
      stdio: ["ignore", out, out],
      env: process.env
    }
  );
  engineIdleSince = Date.now();
  log("engine started pid=" + engine.pid);
  engine.on("exit", (code, signal) => {
    log("engine exited code=" + code + " signal=" + signal);
    engine = null;
  });
  return "starting";
};

// Stops an engine this server started once it has served no torrent for a while.
setInterval(async () => {
  if (!engine) return;
  const stats = await engineGet("/stats.json");
  let busy = true;
  try {
    busy = Object.keys(JSON.parse(stats.body)).length > 0;
  } catch (_) {}
  if (busy) {
    engineIdleSince = Date.now();
    return;
  }
  if (Date.now() - engineIdleSince > ENGINE_IDLE_MS) {
    log("engine idle, stopping");
    try {
      engine.kill();
    } catch (_) {}
  }
}, ENGINE_CHECK_MS).unref();

// ---- add-on inbox ---------------------------------------------------------

const readInbox = () => {
  try {
    const list = JSON.parse(fs.readFileSync(ADDON_INBOX, "utf8"));
    return Array.isArray(list)
      ? list.filter((u) => typeof u === "string" || (u && typeof u === "object"))
      : [];
  } catch (_) {
    return [];
  }
};

const writeInbox = (list) => {
  if (!list.length) {
    fs.rmSync(ADDON_INBOX, { force: true });
    return;
  }
  fs.writeFileSync(ADDON_INBOX + ".tmp", JSON.stringify(list));
  fs.renameSync(ADDON_INBOX + ".tmp", ADDON_INBOX);
};

// ---- static files ---------------------------------------------------------

// Each install is served under its own path, /b/<build>/, so the browser can
// never mix files from two versions. "/" redirects to the current build and is
// never cached; everything under /b/<build>/ is.
const BUILD = String(Math.floor(fs.statSync(path.join(ROOT, "index.html")).mtimeMs));
const BUILD_PREFIX = /^\/b\/[^/]+(\/.*)?$/;

http
  .createServer((req, res) => {
    if (req.method === "POST" && req.url === "/__log") {
      return readBody(req, 16384, (body) => {
        rotate(CLIENT_LOG);
        try {
          fs.appendFileSync(CLIENT_LOG, body.replace(/\n/g, " ") + "\n");
        } catch (_) {}
        res.writeHead(204);
        res.end();
      });
    }
    if (req.method === "GET" && req.url === "/__nuvio/addon-inbox") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify(readInbox()));
    }
    if (req.method === "POST" && req.url === "/__nuvio/addon-inbox/ack") {
      return readBody(req, 65536, (body) => {
        try {
          // Entries are add-on URLs or progress objects; match them by value.
          const taken = new Set(JSON.parse(body).map((u) => JSON.stringify(u)));
          writeInbox(readInbox().filter((u) => !taken.has(JSON.stringify(u))));
          log("add-ons installed by the app: " + taken.size);
        } catch (e) {
          log("inbox ack failed: " + e.message);
        }
        res.writeHead(204);
        res.end();
      });
    }
    if (req.method === "POST" && req.url === "/__nuvio/engine/start") {
      return startEngine().then(
        (state) => {
          res.writeHead(202, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ state }));
        },
        (e) => {
          res.writeHead(500);
          res.end(String(e));
        }
      );
    }
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    } catch (e) {
      res.writeHead(400);
      return res.end();
    }
    if (rel === "/" || rel === "/index.html") {
      const query = new URL(req.url, "http://x").search;
      res.writeHead(302, { Location: `/b/${BUILD}/${query}`, "Cache-Control": "no-store" });
      return res.end();
    }
    const versioned = BUILD_PREFIX.exec(rel);
    if (versioned) rel = versioned[1] || "/";
    let file = path.join(ROOT, path.normalize(rel));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end();
    }
    fs.stat(file, (err, st) => {
      if (!err && st.isDirectory()) file = path.join(file, "index.html");
      fs.readFile(file, (err2, data) => {
        if (err2) {
          res.writeHead(404);
          return res.end("not found");
        }
        res.writeHead(200, {
          "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
          "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "no-cache"
        });
        res.end(data);
      });
    });
  })
  .listen(PORT, "127.0.0.1", () => log(`nuvio: serving ${ROOT} on http://127.0.0.1:${PORT}/`));

// ---- phone page -----------------------------------------------------------
//
// A small page on the home network (http://<tv-ip>:8101/) where a phone can
// paste add-on URLs. They go into the inbox above, which the app installs from
// (Nuvio without an account keeps add-ons only on the TV, and typing a long
// add-on URL with a remote is impractical). This port serves nothing else.

const PHONE_PORT = 8101;

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

const normalizeAddonUrl = (input) => {
  let url = String(input || "").trim();
  if (/^stremio:\/\//i.test(url)) url = url.replace(/^stremio:\/\//i, "https://");
  if (!/^https?:\/\/[^\s]+$/i.test(url) || url.length > 4096) return "";
  try {
    return new URL(url).href;
  } catch (_) {
    return "";
  }
};

const phonePage = (message = "") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nuvio on the TV: add-ons</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f6f8; --fg: #17171c; --muted: #61616b; --card: #fff; --line: #d9d9e0; --accent: #6d4aff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111116; --fg: #ececf1; --muted: #9a9aa6; --card: #1b1b22; --line: #2e2e38; --accent: #9b84ff; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.45 -apple-system, system-ui, sans-serif; }
  main { max-width: 560px; margin: 0 auto; padding: 24px 16px 40px; }
  h1 { font-size: 22px; margin: 0 0 4px; } p { color: var(--muted); margin: 0 0 16px; }
  form { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
  textarea { width: 100%; box-sizing: border-box; min-height: 96px; font: 14px ui-monospace, monospace; padding: 10px;
    border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); }
  button { margin-top: 12px; width: 100%; padding: 12px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font-size: 16px; }
  .msg { margin: 16px 0 0; color: var(--fg); } ul { padding-left: 20px; color: var(--muted); word-break: break-all; }
</style></head><body><main>
<h1>Add-ons for Nuvio on the TV</h1>
<p>Paste add-on links (one per line). <code>stremio://</code> links work too. They appear in Nuvio within a minute, or the next time it opens.</p>
<form method="post" action="/add">
  <textarea name="urls" placeholder="https://…/manifest.json" required></textarea>
  <button type="submit">Send to the TV</button>
</form>
${message ? `<p class="msg">${message}</p>` : ""}
${
  readInbox().some((u) => typeof u === "string")
    ? `<p class="msg">Waiting for Nuvio to pick up:</p><ul>${readInbox()
        .filter((u) => typeof u === "string")
        .map((u) => `<li>${escapeHtml(u)}</li>`)
        .join("")}</ul>`
    : ""
}
</main></body></html>`;

http
  .createServer((req, res) => {
    const send = (status, html) => {
      res.writeHead(status, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(html);
    };
    if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?")))
      return send(200, phonePage());
    if (req.method === "POST" && req.url === "/add") {
      return readBody(req, 65536, (body) => {
        const raw = new URLSearchParams(body).get("urls") || "";
        const urls = raw.split(/\s+/).map(normalizeAddonUrl).filter(Boolean);
        if (!urls.length) return send(400, phonePage("That doesn't look like an add-on link."));
        const inbox = readInbox();
        for (const url of urls) if (!inbox.includes(url)) inbox.push(url);
        writeInbox(inbox);
        log(`phone page queued ${urls.length} add-on(s)`);
        send(200, phonePage(`Sent ${urls.length} add-on${urls.length > 1 ? "s" : ""} to the TV.`));
      });
    }
    res.writeHead(404);
    res.end();
  })
  .listen(PHONE_PORT, "0.0.0.0", () => log(`nuvio: phone add-on page on port ${PHONE_PORT}`));
