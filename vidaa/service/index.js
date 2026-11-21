"use strict";
/* nuviod: boot service for Nuvio on Hisense VIDAA.
 *
 * Loaded at every boot by tv.vidaa.jsservice.basic's service manager
 * (serviceList.json -> autoStart), which runs as UhisPhoenix (uid 314).
 *
 * It does two things and then gets out of the way:
 *   1. starts the local server (serve.cjs) as a detached child process, so a
 *      crash in it can never take the vendor service manager down;
 *   2. makes sure the "Nuvio" web-app entry is still in websdk/Appinfo.json.
 *
 * Everything is wrapped so that a failure here only means "no Nuvio app",
 * never a broken TV.
 */
Object.defineProperty(exports, "__esModule", { value: true });

const CHA = "/APPS/pkgs/tv.vidaa.jsservice.basic/CHA";
try {
  require(CHA + "/node_modules/module-alias").addAlias("@sdk", CHA + "/lib");
} catch (_) {}
let BaseService;
try {
  BaseService = require("@sdk/baseService.js").BaseService;
} catch (e1) {
  try {
    BaseService = require(CHA + "/lib/baseService.js").BaseService;
  } catch (e2) {}
}
if (typeof BaseService !== "function") throw new Error("BaseService unavailable");

const fs = require("fs");
const { spawn } = require("child_process");

const HOME = "/APPS/pkgs/nuvio";
const PORT = 8100;
const LOG = "/tmp/nuviod.log";

function log(msg) {
  try {
    fs.appendFileSync(LOG, new Date().toISOString() + " " + msg + "\n");
  } catch (_) {}
}

function listening(port) {
  const hex = port.toString(16).toUpperCase().padStart(4, "0");
  try {
    for (const line of fs.readFileSync("/proc/net/tcp", "utf8").split("\n")) {
      const f = line.trim().split(/\s+/);
      if (f.length > 3 && f[1] && f[1].split(":")[1] === hex && f[3] === "0A") return true;
    }
  } catch (_) {}
  return false;
}

function startServer() {
  if (listening(PORT)) {
    log("server already listening on " + PORT);
    return;
  }
  let out = "ignore";
  try {
    out = fs.openSync(LOG, "a");
  } catch (_) {}
  const child = spawn(process.execPath, [HOME + "/serve.cjs", HOME, String(PORT)], {
    detached: true,
    stdio: ["ignore", out, out],
    env: Object.assign({}, process.env, {
      LD_LIBRARY_PATH: "/lib:/usr/local/lib:/basic/lib:/3rd/lib:/vendor/lib:/vendor/lib/utopia"
    })
  });
  child.on("error", (e) => log("server spawn error: " + e));
  child.unref();
  log("server started pid=" + child.pid);
}

function ensureAppEntry() {
  try {
    require(HOME + "/setup.cjs").ensureAppEntry(log);
  } catch (e) {
    log("app entry check failed: " + e);
  }
}

class Nuviod extends BaseService {
  constructor(entry) {
    super(entry);
  }
  async start() {
    /* serviceManager awaits 'started' before starting later services. */
    await super.start();
    log("nuviod start pid=" + process.pid + " uid=" + process.getuid());
    try {
      startServer();
    } catch (e) {
      log("start error: " + e);
    }
    ensureAppEntry();
  }
}
module.exports = Nuviod;
