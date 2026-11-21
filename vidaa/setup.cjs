"use strict";
/* Install / uninstall helper for Nuvio on Hisense VIDAA.
 * Runs on the TV's own Node (phoenix).
 *
 *   phoenix setup.cjs install     (from the package postinst, as root)
 *   phoenix setup.cjs uninstall   (from the package prerm, as root)
 *
 * Also exports ensureAppEntry() for the boot service.
 *
 * Every vendor file it edits is backed up once to BACKUP_DIR first, and only
 * rewritten after it parsed cleanly, in place, so owner and mode stay the
 * vendor's. An empty or unreadable Appinfo.json is never written: on some
 * VIDAA builds that leaves the home screen black.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const HOME = "/APPS/pkgs/nuvio";
const BACKUP_DIR = "/APPS/nuvio-backup";
const PORT = 8100;
const APP_URL = `http://127.0.0.1:${PORT}/`;
const ENGINE_DATA = "/var/local/nuvio-engine";

const SERVICES = "/APPS/pkgs/tv.vidaa.jsservice.basic/current/services";
const SERVICE_LIST = SERVICES + "/serviceList.json";
const SERVICE_ID = "nuviod";
const APPINFO = "/APPS/websdk/Appinfo.json";
const APP_ID = "nuvio";

const say = (msg) => console.log("[nuvio] " + msg);

function backupOnce(file) {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const dest = path.join(BACKUP_DIR, path.basename(file) + ".orig");
    if (!fs.existsSync(dest) && fs.existsSync(file)) {
      fs.copyFileSync(file, dest);
      say("backed up " + file + " -> " + dest);
    }
  } catch (e) {
    say("backup of " + file + " failed: " + e.message);
  }
}

// Rewrites the file's bytes in place (same inode, owner and mode).
function writeInPlace(file, text) {
  const fd = fs.openSync(file, "r+");
  try {
    const buf = Buffer.from(text, "utf8");
    fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, buf, 0, buf.length, 0);
  } finally {
    fs.closeSync(fd);
  }
}

function appEntry() {
  const icon = APP_URL + "icon-130.png";
  return {
    Id: APP_ID,
    AppName: "Nuvio",
    Title: "Nuvio",
    URL: APP_URL,
    StartCommand: APP_URL,
    IconURL: icon,
    Icon_96: icon,
    Image: icon,
    Thumb: icon,
    Type: "Browser",
    InstallTime: new Date().toISOString().split("T")[0],
    RunTimes: 0,
    StoreType: "hisense",
    PreInstall: false
  };
}

function readAppInfo() {
  const list = JSON.parse(fs.readFileSync(APPINFO, "utf8"));
  if (!list || !Array.isArray(list.AppInfo)) throw new Error("unexpected Appinfo.json shape");
  return list;
}

function ensureAppEntry(log = say) {
  const list = readAppInfo();
  const existing = list.AppInfo.find((a) => a && a.Id === APP_ID);
  if (existing) {
    // The launcher opens StoreType "hisense" (99) web apps in its 1080p mode and
    // everything else, "custom" included, at 1280x720 (operationui apc-service).
    if (existing.StoreType === "hisense") return false;
    backupOnce(APPINFO);
    existing.StoreType = "hisense";
    writeInPlace(APPINFO, JSON.stringify(list));
    log("set app entry StoreType to hisense (1080p) in " + APPINFO);
    return true;
  }
  backupOnce(APPINFO);
  list.AppInfo.push(appEntry());
  writeInPlace(APPINFO, JSON.stringify(list));
  log("added " + appEntry().AppName + " app entry to " + APPINFO);
  return true;
}

function removeAppEntry() {
  const list = readAppInfo();
  const kept = list.AppInfo.filter((a) => !(a && a.Id === APP_ID));
  if (kept.length === list.AppInfo.length) return;
  if (kept.length === 0) {
    // Never leave an empty registry; see the header comment.
    say("Nuvio is the only app entry; leaving Appinfo.json untouched");
    return;
  }
  list.AppInfo = kept;
  writeInPlace(APPINFO, JSON.stringify(list));
  say("removed Nuvio app entry");
}

function ownLike(target, reference) {
  const st = fs.statSync(reference);
  execSync(`chown -R ${st.uid}:${st.gid} ${JSON.stringify(target)}`);
}

function registerService() {
  const dir = path.join(SERVICES, SERVICE_ID);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ["index.js", "package.json"]) {
    fs.copyFileSync(path.join(HOME, "service", f), path.join(dir, f));
  }
  ownLike(dir, SERVICES);
  fs.chmodSync(dir, 0o755);

  const list = JSON.parse(fs.readFileSync(SERVICE_LIST, "utf8"));
  if (!Array.isArray(list)) throw new Error("unexpected serviceList.json shape");
  if (!list.some((s) => s && s.id === SERVICE_ID)) {
    backupOnce(SERVICE_LIST);
    list.push({ id: SERVICE_ID, autoStart: true, isKeepAlive: true });
    writeInPlace(SERVICE_LIST, JSON.stringify(list, null, 4) + "\n");
    say("registered boot service " + SERVICE_ID);
  }
}

function unregisterService() {
  try {
    const list = JSON.parse(fs.readFileSync(SERVICE_LIST, "utf8"));
    const kept = list.filter((s) => !(s && s.id === SERVICE_ID));
    if (kept.length !== list.length) {
      writeInPlace(SERVICE_LIST, JSON.stringify(kept, null, 4) + "\n");
      say("unregistered boot service");
    }
  } catch (e) {
    say("could not update serviceList.json: " + e.message);
  }
  fs.rmSync(path.join(SERVICES, SERVICE_ID), { recursive: true, force: true });
}

// The server and the torrent engine it starts, found by their command lines.
function ownPids() {
  const pids = [];
  for (const p of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(p)) continue;
    try {
      const cmd = fs.readFileSync(`/proc/${p}/cmdline`, "utf8");
      if (cmd.includes(HOME + "/serve.cjs") || cmd.includes(HOME + "/engine/"))
        pids.push(Number(p));
    } catch (_) {}
  }
  return pids;
}

function stopServer() {
  for (const pid of ownPids()) {
    try {
      process.kill(pid);
      say("stopped pid " + pid);
    } catch (_) {}
  }
}

function startServer() {
  stopServer();
  execSync(
    `/usr/local/bin/busybox setsid ${JSON.stringify(process.execPath)} ${HOME}/serve.cjs ${HOME} ${PORT} ` +
      ">/tmp/nuviod.log 2>&1 </dev/null &",
    { shell: "/bin/sh", env: process.env }
  );
  say("server started on " + APP_URL);
}

function install() {
  registerService();
  ensureAppEntry();
  startServer();
  say("installed. Restart the TV once for the Nuvio tile to appear.");
}

function uninstall() {
  stopServer();
  unregisterService();
  try {
    removeAppEntry();
  } catch (e) {
    say("could not update Appinfo.json: " + e.message);
  }
  fs.rmSync(ENGINE_DATA, { recursive: true, force: true });
  say("uninstalled. Backups of the original files stay in " + BACKUP_DIR);
}

module.exports = { ensureAppEntry };

if (require.main === module) {
  const cmd = process.argv[2];
  try {
    if (cmd === "install") install();
    else if (cmd === "uninstall") uninstall();
    else {
      say("usage: setup.cjs install|uninstall");
      process.exit(2);
    }
  } catch (e) {
    say("FAILED: " + ((e && e.stack) || e));
    process.exit(1);
  }
}
