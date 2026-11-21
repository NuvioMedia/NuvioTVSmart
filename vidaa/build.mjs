/* eslint-disable no-console */
// Packages Nuvio as an opkg .ipk for Hisense VIDAA (mtk9618), installed as the
// "Nuvio" app.
//
//   node vidaa/build.mjs [--skip-app]
//
// Without --skip-app it first runs the normal web build (npm run build ->
// dist/). The package then contains:
//
//   /APPS/pkgs/nuvio/www/        the built web app, marked as VIDAA
//   /APPS/pkgs/nuvio/serve.cjs   local server for 127.0.0.1:8100
//   /APPS/pkgs/nuvio/setup.cjs   install/uninstall helper
//   /APPS/pkgs/nuvio/engine/     torrent engine (Nuvio's Tizen EngineFS runtime)
//   /APPS/pkgs/nuvio/service/    boot service for the vendor service manager
//
// opkg on the TV installs relative to /APPS/pkgs, so data paths start at ./nuvio.
// Install on the TV, as root, with the vendor library path:
//   opkg --force-reinstall install /APPS/nuvio.ipk
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(HERE, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const OUT_DIR = path.join(HERE, "out");
const PKG_NAME = "nuvio";

const run = (cmd, opts = {}) => {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
};

// Minimal ar(1) writer, byte-for-byte the layout of the ipks that install on
// this TV (member names without the GNU trailing slash).
const writeAr = (file, members) => {
  const parts = [Buffer.from("!<arch>\n")];
  for (const { name, data } of members) {
    const field = (value, width) => String(value).padEnd(width, " ").slice(0, width);
    const header =
      field(name, 16) +
      field(0, 12) +
      field(0, 6) +
      field(0, 6) +
      field("100644", 8) +
      field(data.length, 10) +
      "`\n";
    parts.push(Buffer.from(header, "ascii"), data);
    if (data.length % 2) parts.push(Buffer.from("\n"));
  }
  fs.writeFileSync(file, Buffer.concat(parts));
};

const listFiles = (dir, rel = ".") =>
  fs
    .readdirSync(path.join(dir, rel), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? listFiles(dir, `${rel}/${e.name}`) : [`${rel}/${e.name}`]));

// Root-owned, metadata-free gzipped tar of the *files* under dir, paths as ./...
// No directory entries on purpose: a "./" entry would make opkg re-own and
// re-mode /APPS/pkgs itself.
const tarGz = (dir, out) => {
  const list = path.join(path.dirname(out), path.basename(out) + ".list");
  fs.writeFileSync(list, listFiles(dir).join("\n") + "\n");
  run(
    "tar --format ustar --uid 0 --gid 0 --uname root --gname root --no-xattrs --no-mac-metadata -n " +
      `-czf ${JSON.stringify(out)} -C ${JSON.stringify(dir)} -T ${JSON.stringify(list)}`,
    { env: { ...process.env, COPYFILE_DISABLE: "1" } }
  );
};

const copy = (src, dest) => fs.cpSync(src, dest, { recursive: true });

const dirSize = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, e) => {
    const p = path.join(dir, e.name);
    return sum + (e.isDirectory() ? dirSize(p) : fs.statSync(p).size);
  }, 0);

// Nuvio's design size. Installed as a StoreType "hisense" app (vidaa/setup.cjs)
// the VIDAA launcher opens it in its 1080p mode, so the page really is
// 1920x1080 and nothing below changes anything. Opened any other way the
// browser gives it 1280x720; then the page is laid out at this size and
// zoomed down (soft, but the right layout).
const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;

// Marks the page as VIDAA before the bundle loads, and forwards uncaught errors
// to the local server's log (/tmp/nuvio-client.log on the TV).
const VIDAA_HEAD = `
    <script>
      window.__NUVIO_VIDAA__ = true;
      (function reportErrors() {
        function send(kind, data) {
          try {
            navigator.sendBeacon("/__log", JSON.stringify({ t: new Date().toISOString(), kind: kind, data: data }));
          } catch (_) {}
        }
        window.addEventListener("error", function (e) {
          send("error", { msg: String(e.message), src: e.filename, line: e.lineno,
            stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 1500) : "" });
        });
        window.addEventListener("unhandledrejection", function (e) {
          var r = e.reason;
          send("rejection", { msg: String((r && r.message) || r),
            stack: r && r.stack ? String(r.stack).slice(0, 1500) : "" });
        });
      })();
      // The VIDAA browser lays pages out at 1280x720 and ignores the viewport
      // meta tag, while Nuvio is designed for a 1920x1080 layout (at 1280 it
      // switches to its compact, oversized rules). Lay the page out at
      // DESIGN_WIDTH x DESIGN_HEIGHT and zoom it down to the screen; the CSS and
      // JS viewport units were rewritten to that size at build time.
      (function layoutAtDesignSize() {
        var realWidth = window.innerWidth;
        if (!realWidth || realWidth >= ${DESIGN_WIDTH}) return;
        var scale = realWidth / ${DESIGN_WIDTH};
        document.documentElement.style.zoom = String(scale);
        Object.defineProperty(window, "innerWidth", { configurable: true, get: function () { return ${DESIGN_WIDTH}; } });
        Object.defineProperty(window, "innerHeight", { configurable: true, get: function () { return ${DESIGN_HEIGHT}; } });
      })();
    </script>`;

// Optional (NUVIO_VIDAA_DIAG=1 at build time): while a video plays, report
// every 5 s what is on screen around it (focus, text tracks, subtitle
// elements) to /tmp/nuvio-client.log, for checking player overlays on the TV.
const VIDAA_DIAG = `
    <script>
      (function playerDiagnostics() {
        function desc(el) {
          if (!el || !el.tagName) return String(el);
          return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
            (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/).slice(0, 3).join(".") : "");
        }
        setInterval(function () {
          var video = document.getElementById("videoPlayer");
          if (!video || video.paused && !video.currentTime) return;
          var tracks = [];
          for (var i = 0; video.textTracks && i < video.textTracks.length; i++) {
            var tt = video.textTracks[i];
            var cues = tt.activeCues && tt.activeCues.length ? tt.activeCues[0].text : "";
            tracks.push({ kind: tt.kind, label: tt.label, lang: tt.language, mode: tt.mode, cue: String(cues).slice(0, 60) });
          }
          var html = document.querySelector(".player-html-subtitles");
          var line = document.querySelector(".player-html-subtitle-line");
          var active = document.activeElement;
          var cs = active && getComputedStyle(active);
          navigator.sendBeacon("/__log", JSON.stringify({ t: new Date().toISOString(), kind: "player-diag", data: {
            active: desc(active), activeOutline: cs ? cs.outlineStyle + " " + cs.outlineWidth + " " + cs.outlineColor : "",
            tracks: tracks,
            htmlSubs: html ? { hidden: html.classList.contains("hidden"), text: (html.textContent || "").trim().slice(0, 60),
              fontSize: getComputedStyle(html).fontSize } : null,
            line: line ? line.getBoundingClientRect().bottom : null,
            viewport: [innerWidth, innerHeight]
          } }));
        }, 5000);
      })();
    </script>`;

// ---- 1920x1080 layout on a 1280x720 browser --------------------------------
//
// With the page zoomed to 2/3, viewport units would still resolve against the
// real 1280x720 viewport and media queries would still see 1280 px. Both are
// fixed in the built files: vw/vh become pixels of a 1920x1080 viewport, and
// every width/height media query is decided for 1920x1080 once, here.

const px = (value) => `${Math.round(value * 1000) / 1000}px`;

const rewriteViewportUnits = (text) =>
  text.replace(/(?<![\w$.#])(\d*\.?\d+)v([wh])(?![\w$-])/g, (_, n, axis) =>
    px((Number(n) * (axis === "w" ? DESIGN_WIDTH : DESIGN_HEIGHT)) / 100)
  );

const mediaFeatureHolds = (feature) => {
  const m = /^\(\s*(min|max)-(width|height)\s*:\s*(\d+(?:\.\d+)?)px\s*\)$/.exec(feature.trim());
  if (!m) return null;
  const actual = m[2] === "width" ? DESIGN_WIDTH : DESIGN_HEIGHT;
  return m[1] === "min" ? actual >= Number(m[3]) : actual <= Number(m[3]);
};

// "@media (a),(b)" -> "@media all" or "@media not all" when every part is a
// plain min/max width/height test; anything else is left as it is.
const resolveSizeMediaQueries = (css) =>
  css.replace(/@media([^{]+)\{/g, (whole, query) => {
    const results = query.split(",").map(mediaFeatureHolds);
    if (results.some((r) => r === null)) return whole;
    return results.some(Boolean) ? "@media all{" : "@media not all{";
  });

const stageWww = (dest) => {
  copy(DIST_DIR, dest);
  const indexPath = path.join(dest, "index.html");
  const html = fs.readFileSync(indexPath, "utf8");
  if (!html.includes("<head>")) throw new Error("dist/index.html has no <head>");
  if (!html.includes("</head>")) throw new Error("dist/index.html has no </head>");
  const diag = process.env.NUVIO_VIDAA_DIAG === "1" ? VIDAA_DIAG : "";
  fs.writeFileSync(
    indexPath,
    html
      .replace("<head>", `<head>${VIDAA_HEAD}${diag}`)
      // After Nuvio's own stylesheet, so the TV overrides win.
      .replace("</head>", `  <link rel="stylesheet" href="vidaa.css" />\n  </head>`)
  );
  fs.copyFileSync(path.join(HERE, "vidaa.css"), path.join(dest, "vidaa.css"));
  const cssPath = path.join(dest, "css", "bundle.css");
  fs.writeFileSync(
    cssPath,
    resolveSizeMediaQueries(rewriteViewportUnits(fs.readFileSync(cssPath, "utf8")))
  );
  const jsPath = path.join(dest, "app.bundle.js");
  fs.writeFileSync(jsPath, rewriteViewportUnits(fs.readFileSync(jsPath, "utf8")));
  fs.copyFileSync(
    path.join(DIST_DIR, "assets", "images", "largeIcon.png"),
    path.join(dest, "icon-130.png")
  );
};

const stageEngine = (dest) => {
  fs.mkdirSync(path.join(dest, "tizen"), { recursive: true });
  fs.copyFileSync(path.join(HERE, "engine.cjs"), path.join(dest, "engine.cjs"));
  fs.copyFileSync(path.join(HERE, "localhost-only.cjs"), path.join(dest, "localhost-only.cjs"));
  const tizen = path.join(ROOT_DIR, "services", "tizen");
  fs.copyFileSync(
    path.join(tizen, "enginefs-service.js"),
    path.join(dest, "tizen", "enginefs-service.js")
  );
  copy(path.join(tizen, "runtime"), path.join(dest, "tizen", "runtime"));

  // In memory-only mode the engine pauses the swarm once the *average* read
  // progress of all open selections passes 75% of the buffer. The TV's media
  // engine keeps several range requests open (start, tail, and its read
  // position), so stale selections hold that average up and the download
  // stops while playback waits for data: Big Buck Bunny stalled at ~1 min.
  // A cap of 2 can never be reached (progress is at most 1), so the swarm
  // keeps downloading inside the fixed 45 MB memory window.
  const runtime = path.join(dest, "tizen", "runtime", "media-http.cjs");
  const SWARM_CAP = "defaults.swarmCap={minPeers:MIN_PEERS_FOR_STABLE,maxBuffer:.75}";
  const source = fs.readFileSync(runtime, "utf8");
  if (!source.includes(SWARM_CAP))
    throw new Error("EngineFS swarm cap not found; check the runtime bundle");
  fs.writeFileSync(
    runtime,
    source.replace(SWARM_CAP, SWARM_CAP.replace("maxBuffer:.75", "maxBuffer:2"))
  );
};

const main = () => {
  if (!process.argv.includes("--skip-app")) {
    run("npm run build", { cwd: ROOT_DIR });
  }
  if (!fs.existsSync(path.join(DIST_DIR, "index.html"))) {
    throw new Error(`no web build in ${DIST_DIR}; run without --skip-app`);
  }
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"));

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "nuvio-vidaa-"));
  const data = path.join(stage, "data");
  const control = path.join(stage, "control");
  const home = path.join(data, PKG_NAME);

  stageWww(path.join(home, "www"));
  stageEngine(path.join(home, "engine"));
  copy(path.join(HERE, "service"), path.join(home, "service"));
  fs.copyFileSync(path.join(HERE, "serve.cjs"), path.join(home, "serve.cjs"));
  fs.copyFileSync(path.join(HERE, "setup.cjs"), path.join(home, "setup.cjs"));

  fs.mkdirSync(control);
  fs.writeFileSync(
    path.join(control, "control"),
    [
      `Package: ${PKG_NAME}`,
      `Version: ${version}`,
      "Architecture: mtk9618",
      `AppId: ${PKG_NAME}`,
      "AppName: Nuvio",
      "Section: ns",
      "Priority: optional",
      "Maintainer: gwerneckp",
      "Description: Nuvio (Stremio-addon media client) for Hisense VIDAA",
      "Format: 1",
      "Persistent: false",
      "PackageType: Entry",
      "Userid: 0:0",
      `Installed-Size: ${Math.ceil(dirSize(data) / 1024)}`,
      ""
    ].join("\n")
  );
  for (const script of ["postinst", "prerm"]) {
    fs.copyFileSync(path.join(HERE, script), path.join(control, script));
    fs.chmodSync(path.join(control, script), 0o755);
  }

  const controlTar = path.join(stage, "control.tar.gz");
  const dataTar = path.join(stage, "data.tar.gz");
  tarGz(control, controlTar);
  tarGz(data, dataTar);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ipk = path.join(OUT_DIR, `${PKG_NAME}_${version}_mtk9618.ipk`);
  writeAr(ipk, [
    { name: "debian-binary", data: Buffer.from("2.0\n") },
    { name: "control.tar.gz", data: fs.readFileSync(controlTar) },
    { name: "data.tar.gz", data: fs.readFileSync(dataTar) }
  ]);
  fs.rmSync(stage, { recursive: true, force: true });
  console.log(`\n Built ${ipk} (${(fs.statSync(ipk).size / 1048576).toFixed(1)} MB)`);
};

main();
