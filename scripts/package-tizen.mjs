import { access, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { readAppMetadata, syncVersionFiles } from "./appMetadata.mjs";
import { compatibilityPolicy } from "./compatibilityPolicy.mjs";
import { writeRuntimeEnvScriptFile } from "./envProperties.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const cacheDir = path.join(rootDir, ".cache");
const stagingDir = path.join(cacheDir, "tizen-package");
const requireConfiguredRuntimeEnv = /^(1|true|yes|on)$/i.test(
  String(process.env.NUVIO_REQUIRE_LOCAL_PROPERTIES || "")
);

const appName = "Nuvio TV";
const defaultTizenPackageId = "NuvioTV001";
const defaultTizenAppId = "NuvioTV001.NuvioTV";
const defaultWidgetUri = "https://nuvio.tv";
const tizenEngineFsServiceRelativePath = "services/tizen/enginefs-service.js";
const tizenEngineFsRuntimeDirRelativePath = "services/tizen/runtime";

function normalizeVersion(version) {
  const parts = String(version || "0.0.0")
    .replace(/^v/i, "")
    .split(".")
    .map((part) => String(Number.parseInt(part, 10) || 0));
  while (parts.length < 3) {
    parts.push("0");
  }
  return parts.slice(0, 3).join(".");
}

async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function assertDistExists() {
  try {
    await access(path.join(distDir, "app.bundle.js"), fsConstants.R_OK);
  } catch {
    throw new Error(`Build output not found at ${distDir}. Run "npm run build" first.`);
  }
}

function buildConfigXml({ appId, packageId, version }) {
  const engineFsServiceId = `${packageId}.EngineFsService`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns:tizen="http://tizen.org/ns/widgets" xmlns="http://www.w3.org/ns/widgets" id="${defaultWidgetUri}" version="${version}" viewmodes="maximized">
  <access origin="*" subdomains="true"/>
  <tizen:application id="${appId}" package="${packageId}" required_version="${compatibilityPolicy.tizenRequiredVersion}"/>
  <author href="${defaultWidgetUri}">Nuvio</author>
  <content src="index.html"/>
  <feature name="http://tizen.org/feature/screen.size.all"/>
  <feature name="http://tizen.org/feature/web.service"/>
  <icon src="icon.png"/>
  <name>${appName}</name>
  <tizen:privilege name="http://tizen.org/privilege/internet"/>
  <tizen:privilege name="http://developer.samsung.com/privilege/network.public"/>
  <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
  <tizen:service id="${engineFsServiceId}" auto-restart="true" on-boot="false">
    <tizen:content src="${tizenEngineFsServiceRelativePath}"/>
    <tizen:name>Nuvio EngineFS Service</tizen:name>
    <tizen:icon src="icon.png"/>
    <tizen:description>Local torrent streaming service for Nuvio Tizen playback</tizen:description>
    <tizen:category name="http://tizen.org/category/service"/>
  </tizen:service>
  <tizen:profile name="tv-samsung"/>
  <tizen:setting screen-orientation="landscape" context-menu="enable" background-support="disable" encryption="disable" install-location="auto" hwkey-event="enable"/>
</widget>
`;
}

function buildIndexHtml() {
  return `<!DOCTYPE html>
<html lang="en" class="no-flex-gap no-css-math no-backdrop-filter no-aspect-ratio">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=1920, height=1080, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${appName}</title>
  <script src="assets/runtime/legacy-features.js"></script>
  <link rel="stylesheet" href="css/base.css" />
  <link rel="stylesheet" href="css/layout.css" />
  <link rel="stylesheet" href="css/components.css" />
  <link rel="stylesheet" href="css/themes.css" />
</head>
<body>
  <script src="boot-guard.js"></script>
  <script src="core-js.bundle.js" onerror="window.NuvioBootGuard &amp;&amp; window.NuvioBootGuard.scriptFailed(this.src)"></script>
  <script defer src="main.js" onerror="window.NuvioBootGuard &amp;&amp; window.NuvioBootGuard.scriptFailed(this.src)"></script>
</body>
</html>
`;
}

function buildMainJs({ packageId }) {
  const engineFsServiceId = `${packageId}.EngineFsService`;
  const compatibilityOptions = JSON.stringify({
    platform: "tizen",
    minVersion: Number.parseInt(compatibilityPolicy.tizenRequiredVersion, 10),
    minChrome: compatibilityPolicy.chromiumVersion,
    requiredLabel: `Samsung Tizen ${compatibilityPolicy.tizenRequiredVersion}+ · Chromium ${compatibilityPolicy.chromiumVersion}+ (${compatibilityPolicy.tizenSupportYear}+)`
  });
  return `window.__NUVIO_PLATFORM__ = "tizen";
window.__NUVIO_TIZEN_ENGINEFS_SERVICE_ID__ = ${JSON.stringify(engineFsServiceId)};

var tvInput = window.tizen && window.tizen.tvinputdevice;
if (tvInput && typeof tvInput.registerKey === "function") {
  [
    "Back",
    "Return",
    "MediaPlay",
    "MediaPause",
    "MediaPlayPause",
    "MediaStop",
    "MediaFastForward",
    "MediaRewind",
    "MediaTrackPrevious",
    "MediaTrackNext"
  ].forEach(function registerKey(keyName) {
    try {
      tvInput.registerKey(keyName);
    } catch (_) {}
  });
}

function loadScript(src) {
  var script = document.createElement("script");
  script.async = false;
  script.src = src;
  script.defer = false;
  script.onerror = function handleStartupScriptError() {
    if (window.NuvioBootGuard) {
      window.NuvioBootGuard.scriptFailed(src);
    }
  };
  if (window.NuvioBootGuard) {
    window.NuvioBootGuard.stage("Loading " + src);
  }
  document.body.appendChild(script);
}

function startNuvioApp() {
  loadScript("nuvio.env.js");
  loadScript("assets/libs/qrcode-generator.js");
  loadScript("app.bundle.js");
}

if (window.NuvioBootGuard && typeof window.NuvioBootGuard.runCompatibilityGate === "function") {
  window.NuvioBootGuard.runCompatibilityGate(${compatibilityOptions}, startNuvioApp);
} else {
  startNuvioApp();
}
`;
}

async function stageTizenEngineFsService() {
  const serviceDir = path.join(stagingDir, "services", "tizen");
  await mkdir(serviceDir, { recursive: true });
  await Promise.all([
    cp(
      path.join(rootDir, "services", "tizen", "enginefs-service.js"),
      path.join(stagingDir, tizenEngineFsServiceRelativePath)
    ),
    cp(
      path.join(rootDir, "services", "tizen", "runtime"),
      path.join(stagingDir, tizenEngineFsRuntimeDirRelativePath),
      { recursive: true }
    )
  ]);
}

async function copyDistFolder(folderName) {
  const source = path.join(distDir, folderName);
  if (!(await pathExists(source))) {
    return;
  }
  await cp(source, path.join(stagingDir, folderName), { recursive: true });
}

async function stagePackage({ appId, packageId, version, envSourcePath }) {
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  await Promise.all([
    copyDistFolder("assets"),
    copyDistFolder("css"),
    copyDistFolder("res"),
    cp(path.join(distDir, "app.bundle.js"), path.join(stagingDir, "app.bundle.js")),
    cp(path.join(distDir, "core-js.bundle.js"), path.join(stagingDir, "core-js.bundle.js")),
    cp(path.join(distDir, "boot-guard.js"), path.join(stagingDir, "boot-guard.js")),
    cp(path.join(distDir, "youtube-proxy.html"), path.join(stagingDir, "youtube-proxy.html")),
    cp(path.join(rootDir, "assets", "images", "tizenIcon.png"), path.join(stagingDir, "icon.png")),
    writeFile(
      path.join(stagingDir, "config.xml"),
      buildConfigXml({ appId, packageId, version }),
      "utf8"
    ),
    writeFile(path.join(stagingDir, "index.html"), buildIndexHtml(), "utf8"),
    writeFile(path.join(stagingDir, "main.js"), buildMainJs({ packageId }), "utf8")
  ]);
  await stageTizenEngineFsService();

  if (envSourcePath) {
    await writeRuntimeEnvScriptFile(path.join(stagingDir, "nuvio.env.js"), {
      rootDir,
      sourcePath: envSourcePath
    });
  } else {
    await cp(path.join(distDir, "nuvio.env.js"), path.join(stagingDir, "nuvio.env.js"));
  }

  if (await pathExists(path.join(distDir, "app.bundle.js.map"))) {
    await cp(path.join(distDir, "app.bundle.js.map"), path.join(stagingDir, "app.bundle.js.map"));
  }
}

async function addDirectoryToZip(zip, dir, baseDir = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".DS_Store") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath).split(path.sep).join("/");
    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, fullPath, baseDir);
    } else if (entry.isFile()) {
      zip.file(relativePath, await readFile(fullPath));
    }
  }
}

function parseArgs(argv) {
  const options = {
    outDir: rootDir,
    appId: process.env.TIZEN_APP_ID || defaultTizenAppId,
    packageId: process.env.TIZEN_PACKAGE_ID || defaultTizenPackageId,
    envSourcePath: process.env.TIZEN_ENV_SOURCE || ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--outdir") {
      options.outDir = path.resolve(argv[index + 1] || "");
      index += 1;
    } else if (arg === "--app-id") {
      options.appId = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--package-id") {
      options.packageId = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--env-source") {
      options.envSourcePath = path.resolve(argv[index + 1] || "");
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.appId || !options.packageId) {
    throw new Error("Tizen app id and package id are required.");
  }

  return options;
}

async function packageTizen() {
  const options = parseArgs(process.argv.slice(2));
  if (requireConfiguredRuntimeEnv && !options.envSourcePath) {
    options.envSourcePath = path.join(rootDir, "local.properties");
  }
  if (requireConfiguredRuntimeEnv && !(await pathExists(options.envSourcePath))) {
    throw new Error(
      "Configured runtime env is required for Tizen packaging. Provide local.properties or --env-source."
    );
  }

  await syncVersionFiles();
  await assertDistExists();

  const { version: rawVersion } = await readAppMetadata();
  const version = normalizeVersion(rawVersion);
  await stagePackage({ ...options, version });

  await mkdir(options.outDir, { recursive: true });
  const outputPath = path.join(options.outDir, `${options.packageId}_${version}.wgt`);
  const zip = new JSZip();
  await addDirectoryToZip(zip, stagingDir);
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE"
  });
  await writeFile(outputPath, buffer);

  console.log(`Tizen WGT created: ${outputPath}`);
  console.log(`Tizen application id: ${options.appId}`);
  console.log(`Tizen package id: ${options.packageId}`);
  console.log(
    `Runtime env bundled from: ${options.envSourcePath || path.join(distDir, "nuvio.env.js")}`
  );
}

try {
  await packageTizen();
} catch (error) {
  console.error("\nTizen packaging failed:");
  console.error(error);
  process.exit(1);
}
