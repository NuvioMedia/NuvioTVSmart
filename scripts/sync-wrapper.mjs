import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { constants as fsConstants } from "node:fs";
import { readAppMetadata, syncVersionFiles } from "./appMetadata.mjs";
import { compatibilityPolicy } from "./compatibilityPolicy.mjs";
import { writeRuntimeEnvScriptFile } from "./envProperties.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const appName = "Nuvio TV";
const webOsRuntimeScriptPath = "assets/libs/webOSTV.js";
const legacyWebOsServiceSourceDirName = "space.nuvio.webos.service";
const webOsServiceSourceDirName = "webos";
const webOsServiceId = "space.nuvio.webos.service";
const webOsServiceDirName = webOsServiceId;
const tizenEngineFsServiceDirName = "tizen";
const tizenEngineFsServiceRelativePath = "services/tizen/enginefs-service.js";
const tizenEngineFsRuntimeDirRelativePath = "services/tizen/runtime";
const wrapperIconFiles = {
  webosIcon: {
    source: path.join(rootDir, "assets", "images", "icon.png"),
    target: "icon.png"
  },
  webosLargeIcon: {
    source: path.join(rootDir, "assets", "images", "largeIcon.png"),
    target: "largeIcon.png"
  },
  webosSplash: {
    source: path.join(rootDir, "assets", "images", "splash.png"),
    target: "splash.png"
  },
  tizenIcon: {
    source: path.join(rootDir, "assets", "images", "tizenIcon.png"),
    target: "icon.png"
  }
};

function fail(message) {
  throw new Error(
    `${message}\n\nUsage: node ./scripts/sync-wrapper.mjs --webos|--tizen --path /absolute/path/to/project`
  );
}

function parseArgs(argv) {
  let platform = "";
  let targetPath = "";
  const positionalArgs = [];
  const npmConfigPath = process.env.npm_config_path;
  const npmProvidedPath = npmConfigPath && npmConfigPath !== "true" ? npmConfigPath : "";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--webos" || arg === "--tizen") {
      if (platform) {
        fail("Choose exactly one platform flag.");
      }
      platform = arg.slice(2);
      continue;
    }

    if (arg === "--path") {
      targetPath = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (!arg.startsWith("--")) {
      positionalArgs.push(arg);
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (!platform) {
    if (process.env.npm_config_webos) {
      platform = "webos";
    } else if (process.env.npm_config_tizen) {
      platform = "tizen";
    }
  }

  if (!targetPath) {
    targetPath = positionalArgs[0] || npmProvidedPath || "";
  }

  if (!platform) {
    fail("Missing platform flag.");
  }

  if (!targetPath) {
    fail("Missing --path.");
  }

  if (!path.isAbsolute(targetPath)) {
    fail(`Target path must be absolute: ${targetPath}`);
  }

  return {
    platform,
    targetDir: targetPath
  };
}

async function assertDistExists() {
  try {
    await access(distDir, fsConstants.R_OK);
  } catch {
    throw new Error(`Build output not found at ${distDir}. Run "npm run build" first.`);
  }
}

async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function syncFolder(targetDir, folderName) {
  await rm(path.join(targetDir, folderName), { recursive: true, force: true });
  await cp(path.join(distDir, folderName), path.join(targetDir, folderName), { recursive: true });
}

async function syncServiceFolder(
  targetDir,
  serviceDirName,
  { targetServiceDirName = serviceDirName } = {}
) {
  const targetServicesDir = path.join(targetDir, "services");
  await mkdir(targetServicesDir, { recursive: true });
  await rm(path.join(targetServicesDir, legacyWebOsServiceSourceDirName), {
    recursive: true,
    force: true
  });
  await rm(path.join(targetServicesDir, webOsServiceSourceDirName), {
    recursive: true,
    force: true
  });
  await rm(path.join(targetServicesDir, webOsServiceDirName), { recursive: true, force: true });
  await cp(
    path.join(rootDir, "services", serviceDirName),
    path.join(targetServicesDir, targetServiceDirName),
    { recursive: true }
  );
}

async function syncBuild(targetDir) {
  await mkdir(targetDir, { recursive: true });
  await Promise.all([
    syncFolder(targetDir, "assets"),
    syncFolder(targetDir, "css"),
    syncFolder(targetDir, "res")
  ]);

  await cp(path.join(distDir, "app.bundle.js"), path.join(targetDir, "app.bundle.js"));
  await cp(path.join(distDir, "core-js.bundle.js"), path.join(targetDir, "core-js.bundle.js"));
  await cp(path.join(distDir, "boot-guard.js"), path.join(targetDir, "boot-guard.js"));
  await cp(path.join(distDir, "youtube-proxy.html"), path.join(targetDir, "youtube-proxy.html"));
  try {
    await cp(path.join(distDir, "nuvio.env.js"), path.join(targetDir, "nuvio.env.js"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      await writeRuntimeEnvScriptFile(path.join(targetDir, "nuvio.env.js"), { rootDir });
      return;
    }
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}
async function resolveBundledWebOsRuntime(targetDir) {
  const targetScriptPath = path.join(targetDir, webOsRuntimeScriptPath);
  if (!(await pathExists(targetScriptPath))) {
    return "";
  }

  return webOsRuntimeScriptPath;
}

function buildWebOsIndexHtml({ webOsScriptPath = "" } = {}) {
  const webOsScriptTag = webOsScriptPath ? `  <script src="${webOsScriptPath}"></script>\n` : "";
  const compatibilityOptions = JSON.stringify({
    platform: "webos",
    minVersion: Number.parseInt(compatibilityPolicy.webOsRequiredVersion, 10),
    minChrome: compatibilityPolicy.webOsChromiumVersion,
    requiredLabel: `LG webOS ${compatibilityPolicy.webOsRequiredVersion}+ · Chromium ${compatibilityPolicy.webOsChromiumVersion}+ (${compatibilityPolicy.webOsSupportYear}+)`
  });

  return `<!DOCTYPE html>
<html lang="en" class="no-flex-gap no-css-math no-backdrop-filter no-aspect-ratio">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
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
  <script>window.__NUVIO_PLATFORM__ = "webos";</script>
  <script src="nuvio.env.js"></script>
  <script src="assets/libs/qrcode-generator.js"></script>
${webOsScriptTag}  <script>
    window.NuvioBootGuard.runCompatibilityGate(${compatibilityOptions}, function startNuvioApp() {
      window.NuvioBootGuard.loadScript("app.bundle.js");
    });
  </script>
</body>
</html>
`;
}

function buildTizenIndexHtml() {
  return `<!DOCTYPE html>
<html lang="en" class="no-flex-gap no-css-math no-backdrop-filter no-aspect-ratio">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=1920, height=1080, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${appName}</title>
  <script src="$WEBAPIS/webapis/webapis.js"></script>
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

function buildTizenMainJs({ engineFsServiceId = "" } = {}) {
  const compatibilityOptions = JSON.stringify({
    platform: "tizen",
    minVersion: Number.parseInt(compatibilityPolicy.tizenRequiredVersion, 10),
    minChrome: compatibilityPolicy.chromiumVersion,
    requiredLabel: `Samsung Tizen ${compatibilityPolicy.tizenRequiredVersion}+ · Chromium ${compatibilityPolicy.chromiumVersion}+ (${compatibilityPolicy.tizenSupportYear}+)`
  });
  return `/// <reference path="../../index.d.ts" />

(function bootstrapTizen() {
  "use strict";

  window.__NUVIO_PLATFORM__ = "tizen";
  window.__NUVIO_TIZEN_ENGINEFS_SERVICE_ID__ = ${JSON.stringify(engineFsServiceId)};

  function registerRemoteKeys() {
    var tvInput = window.tizen && window.tizen.tvinputdevice;
    if (!tvInput || typeof tvInput.registerKey !== "function") {
      return;
    }

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
      } catch (ignored) {}
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

  registerRemoteKeys();

  if (window.NuvioBootGuard && typeof window.NuvioBootGuard.runCompatibilityGate === "function") {
    window.NuvioBootGuard.runCompatibilityGate(${compatibilityOptions}, startNuvioApp);
  } else {
    startNuvioApp();
  }
}());
`;
}

async function readTextFile(filePath, missingMessage) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(missingMessage);
    }
    throw error;
  }
}

async function writeTextFile(filePath, contents) {
  await writeFile(filePath, contents, "utf8");
}

async function syncWrapperIcons(targetDir, { includeLargeIcon }) {
  const iconTasks = [wrapperIconFiles.webosIcon];
  if (includeLargeIcon) {
    iconTasks.push(wrapperIconFiles.webosLargeIcon);
    iconTasks.push(wrapperIconFiles.webosSplash);
  }

  await Promise.all(
    iconTasks.map(({ source, target }) => cp(source, path.join(targetDir, target)))
  );
}

async function syncTizenIcon(targetDir) {
  await cp(
    wrapperIconFiles.tizenIcon.source,
    path.join(targetDir, wrapperIconFiles.tizenIcon.target)
  );
}

async function updateWebOsMetadata(targetDir) {
  const { version: appVersion } = await readAppMetadata();
  const appInfoPath = path.join(targetDir, "appinfo.json");
  const appInfoRaw = await readTextFile(
    appInfoPath,
    `webOS wrapper metadata not found at ${appInfoPath}. Expected appinfo.json in the wrapper root.`
  );
  const appInfo = JSON.parse(appInfoRaw);

  appInfo.title = appName;
  appInfo.version = appVersion;
  appInfo.icon = wrapperIconFiles.webosIcon.target;
  appInfo.largeIcon = wrapperIconFiles.webosLargeIcon.target;
  appInfo.splashBackground = wrapperIconFiles.webosSplash.target;
  appInfo.services = [webOsServiceId];
  appInfo.requiredVersion = compatibilityPolicy.webOsRequiredVersion;
  delete appInfo.disableBackHistoryAPI;

  await writeTextFile(appInfoPath, `${JSON.stringify(appInfo, null, 2)}\n`);
  await syncWrapperIcons(targetDir, { includeLargeIcon: true });
}

async function syncWebOsCompanionFiles(targetDir) {
  await syncServiceFolder(targetDir, webOsServiceSourceDirName, {
    targetServiceDirName: webOsServiceDirName
  });

  const serviceDir = path.join(targetDir, "services", webOsServiceDirName);
  const filesToRewrite = [
    path.join(serviceDir, "package.json"),
    path.join(serviceDir, "services.json"),
    path.join(serviceDir, "src", "serverHost.js")
  ];

  await Promise.all(
    filesToRewrite.map(async (filePath) => {
      const current = await readTextFile(filePath, `Expected webOS service file at ${filePath}.`);
      await writeTextFile(
        filePath,
        current.replaceAll(legacyWebOsServiceSourceDirName, webOsServiceId)
      );
    })
  );
}

async function syncTizenEngineFsService(targetDir) {
  const serviceDir = path.join(targetDir, "services", tizenEngineFsServiceDirName);
  await rm(serviceDir, { recursive: true, force: true });
  await mkdir(serviceDir, { recursive: true });

  await Promise.all([
    cp(
      path.join(rootDir, "services", "tizen", "enginefs-service.js"),
      path.join(targetDir, tizenEngineFsServiceRelativePath)
    ),
    cp(
      path.join(rootDir, "services", "tizen", "runtime"),
      path.join(targetDir, tizenEngineFsRuntimeDirRelativePath),
      { recursive: true }
    )
  ]);
}

function upsertXmlTag(xml, tagName, innerText) {
  const tagPattern = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`);
  if (tagPattern.test(xml)) {
    return xml.replace(tagPattern, `<${tagName}>${innerText}</${tagName}>`);
  }

  return insertIntoWidget(xml, `<${tagName}>${innerText}</${tagName}>`);
}

function upsertTizenIcon(xml, iconSrc) {
  const iconPattern =
    /<icon\b[^>]*src="[^"]*"[^>]*>([\s\S]*?)<\/icon>|<icon\b[^>]*src="[^"]*"[^>]*\/>/;
  if (iconPattern.test(xml)) {
    let replaced = false;
    return xml.replace(iconPattern, () => {
      if (replaced) {
        return "";
      }
      replaced = true;
      return `<icon src="${iconSrc}"/>`;
    });
  }

  return insertIntoWidget(xml, `<icon src="${iconSrc}"/>`);
}

function upsertTizenFeature(xml, featureName) {
  const escaped = featureName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const featurePattern = new RegExp(`<feature\\b[^>]*name="${escaped}"[^>]*/>`);
  if (featurePattern.test(xml)) {
    return xml;
  }
  return insertIntoWidget(xml, `<feature name="${featureName}"/>`);
}

function readTizenApplicationId(xml) {
  const match = String(xml || "").match(/<tizen:application\b[^>]*\bid="([^"]+)"/);
  return match ? match[1] : "";
}

function removeTizenEngineFsService(xml) {
  return String(xml || "").replace(
    /\s*<tizen:service\b[^>]*EngineFsService[^>]*>[\s\S]*?<\/tizen:service>/g,
    ""
  );
}

function upsertTizenEngineFsService(xml, serviceId) {
  const serviceSnippet = `<tizen:service id="${serviceId}" auto-restart="true" on-boot="false">
    <tizen:content src="${tizenEngineFsServiceRelativePath}"/>
    <tizen:name>Nuvio EngineFS Service</tizen:name>
    <tizen:description>Local torrent streaming service for Nuvio Tizen playback</tizen:description>
  </tizen:service>`;
  const withoutOldService = removeTizenEngineFsService(xml);
  if (/<tizen:profile\b/.test(withoutOldService)) {
    return withoutOldService.replace(/<tizen:profile\b/, `${serviceSnippet}\n  <tizen:profile`);
  }
  return insertIntoWidget(withoutOldService, serviceSnippet);
}

function insertIntoWidget(xml, snippet) {
  const widgetOpenTagPattern = /<widget\b[^>]*>/;
  if (!widgetOpenTagPattern.test(xml)) {
    throw new Error("Invalid Tizen config.xml: missing <widget> root tag.");
  }

  return xml.replace(widgetOpenTagPattern, (match) => `${match}\n    ${snippet}`);
}

function upsertTizenWidgetVersion(xml, version) {
  const widgetPattern = /<widget\b([^>]*?)\bversion="[^"]*"([^>]*)>/;
  if (widgetPattern.test(xml)) {
    return xml.replace(widgetPattern, `<widget$1version="${version}"$2>`);
  }
  return xml;
}

function upsertTizenRequiredVersion(xml, version) {
  const applicationPattern = /<tizen:application\b([^>]*?)\brequired_version="[^"]*"([^>]*)\/>/;
  if (applicationPattern.test(xml)) {
    return xml.replace(applicationPattern, `<tizen:application$1required_version="${version}"$2/>`);
  }

  return xml.replace(
    /<tizen:application\b([^>]*)\/>/,
    `<tizen:application$1 required_version="${version}"/>`
  );
}

async function updateTizenMetadata(targetDir) {
  const { version: appVersion } = await readAppMetadata();
  const configPath = path.join(targetDir, "config.xml");
  const configRaw = await readTextFile(
    configPath,
    `Tizen wrapper metadata not found at ${configPath}. Expected config.xml in the wrapper root.`
  );
  let configXml = configRaw;

  configXml = upsertTizenIcon(configXml, wrapperIconFiles.tizenIcon.target);
  configXml = upsertXmlTag(configXml, "name", appName);
  configXml = upsertTizenWidgetVersion(configXml, appVersion);
  configXml = upsertTizenRequiredVersion(configXml, compatibilityPolicy.tizenRequiredVersion);
  configXml = upsertTizenFeature(configXml, "http://tizen.org/feature/web.service");
  const tizenAppId = readTizenApplicationId(configXml);
  const engineFsServiceId = tizenAppId ? `${tizenAppId}.EngineFsService` : "";
  if (engineFsServiceId) {
    configXml = upsertTizenEngineFsService(configXml, engineFsServiceId);
  }

  await writeTextFile(configPath, configXml);
  await syncTizenIcon(targetDir);
  await writeTextFile(path.join(targetDir, "index.html"), buildTizenIndexHtml());
  await writeTextFile(path.join(targetDir, "main.js"), buildTizenMainJs({ engineFsServiceId }));
  await syncTizenEngineFsService(targetDir);
}
const { platform, targetDir } = parseArgs(process.argv.slice(2));
await syncVersionFiles();
await mkdir(targetDir, { recursive: true });

if (platform === "webos") {
  await assertDistExists();
  await syncBuild(targetDir);
  await updateWebOsMetadata(targetDir);
  await syncWebOsCompanionFiles(targetDir);
  const webOsScriptPath = await resolveBundledWebOsRuntime(targetDir);
  await writeTextFile(path.join(targetDir, "index.html"), buildWebOsIndexHtml({ webOsScriptPath }));
}

if (platform === "tizen") {
  await assertDistExists();
  await syncBuild(targetDir);
  await updateTizenMetadata(targetDir);
}

console.log(`Synced ${platform} wrapper assets to ${targetDir}`);
