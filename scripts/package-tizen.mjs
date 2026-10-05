import { access, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
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
const signedOutputDir = path.join(cacheDir, "tizen-signed-output");
const requireConfiguredRuntimeEnv = /^(1|true|yes|on)$/i.test(
  String(process.env.NUVIO_REQUIRE_LOCAL_PROPERTIES || "")
);

const appName = "Nuvio TV";
const defaultTizenPackageId = "NuvioTV001";
const defaultTizenAppId = "NuvioTV001.NuvioTV";
const defaultWidgetUri = "https://nuvio.tv";
const tizenEngineFsServiceRelativePath = "services/tizen/enginefs-service.js";
const tizenEngineFsRuntimeDirRelativePath = "services/tizen/runtime";
const tizenPluginServiceRelativePath = "services/tizen/plugin-service.js";
const tizenPluginServiceSourceRelativePath = "services/plugin-http.cjs";
const tizenEngineFsServicePort = 2710;
const tizenPluginServicePort = 2711;

function buildTizenServiceBridgeMarkup(enabled) {
  if (!enabled) return "";
  // Keep the WRT service import inline, matching Samsung's Web Service example.
  return `  <script type="module">
    import * as service from "wrt:service";
    if (typeof window !== "undefined") {
      window.__NUVIO_TIZEN_WRT_SERVICE__ = service;
    }
  </script>\n`;
}

function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ""));
}

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

function buildConfigXml({
  appId,
  packageId,
  version,
  includeEngineFsService,
  includePluginService,
  serviceMetadataXml = ""
}) {
  const engineFsServiceId = `${packageId}.EngineFsService`;
  const pluginServiceId = `${packageId}.PluginService`;
  const hasLocalService = includeEngineFsService || includePluginService;
  const serviceFeature = hasLocalService
    ? '  <feature name="http://tizen.org/feature/web.service"/>\n'
    : "";
  const applicationLaunchPrivilege = hasLocalService
    ? '  <tizen:privilege name="http://tizen.org/privilege/application.launch"/>\n'
    : "";
  const serviceMetadata = serviceMetadataXml ? `\n    ${serviceMetadataXml}` : "";
  const engineFsService = includeEngineFsService
    ? `  <tizen:service id="${engineFsServiceId}" type="ui" auto-restart="false" on-boot="false">
    <tizen:content src="${tizenEngineFsServiceRelativePath}"/>${serviceMetadata}
    <tizen:name>Nuvio EngineFS Service</tizen:name>
    <tizen:icon src="icon.png"/>
    <tizen:description>Local torrent streaming service for Nuvio Tizen playback</tizen:description>
    <tizen:category name="http://tizen.org/category/service"/>
  </tizen:service>
`
    : "";
  const pluginService = includePluginService
    ? `  <tizen:service id="${pluginServiceId}" type="ui" auto-restart="false" on-boot="false">
    <tizen:content src="${tizenPluginServiceRelativePath}"/>
    <tizen:name>Nuvio Plugin Network Service</tizen:name>
    <tizen:icon src="icon.png"/>
    <tizen:description>Bounded network service for Nuvio JavaScript plugins</tizen:description>
    <tizen:category name="http://tizen.org/category/service"/>
  </tizen:service>
`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns:tizen="http://tizen.org/ns/widgets" xmlns="http://www.w3.org/ns/widgets" id="${defaultWidgetUri}" version="${version}" viewmodes="maximized">
  <access origin="*" subdomains="true"/>
  <tizen:application id="${appId}" package="${packageId}" required_version="${compatibilityPolicy.tizenInstallMinimumVersion}"/>
  <author href="${defaultWidgetUri}">Nuvio</author>
  <content src="index.html"/>
  <feature name="http://tizen.org/feature/screen.size.all"/>
${serviceFeature}  <icon src="icon.png"/>
  <name>${appName}</name>
  <tizen:privilege name="http://tizen.org/privilege/internet"/>
  <tizen:privilege name="http://tizen.org/privilege/unlimitedstorage"/>
${applicationLaunchPrivilege}  <tizen:privilege name="http://developer.samsung.com/privilege/network.public"/>
  <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
${engineFsService}${pluginService}  <tizen:profile name="tv-samsung"/>
  <tizen:setting screen-orientation="landscape" context-menu="enable" background-support="disable" encryption="disable" install-location="auto"/>
</widget>
`;
}

/*
 * EngineFS is part of the supported TV application, including the Store
 * package. Do not silently publish a Store build without the local service:
 * that would make P2P disappear from otherwise capable Tizen TVs.
 *
 * Optional service metadata is still accepted for a Seller Office request,
 * but it is never invented or required by this package script.
 */
function validateStoreServiceOptions({
  includeEngineFsService,
  includePluginService,
  storeBuild,
  serviceMetadataXml
}) {
  if (storeBuild && !includeEngineFsService) {
    throw new Error(
      "Tizen Store packaging must include the local EngineFS service so supported TVs retain torrent/P2P playback. " +
        "Remove --no-enginefs-service and do not set TIZEN_INCLUDE_ENGINEFS_SERVICE=false."
    );
  }

  if (storeBuild && !includePluginService) {
    throw new Error(
      "Tizen Store packaging must include the local Plugin Network service so JS plugins fail closed only on unsupported TVs. " +
        "Remove --no-plugin-service and do not set TIZEN_INCLUDE_PLUGIN_SERVICE=false."
    );
  }

  if (serviceMetadataXml && !/^<tizen:metadata\b[\s\S]*\/>$/.test(serviceMetadataXml)) {
    throw new Error(
      "TIZEN_SERVICE_METADATA_XML must contain one self-closing <tizen:metadata .../> element."
    );
  }
}

function buildIndexHtml({ includeEngineFsService = false, includePluginService = false } = {}) {
  const pluginServiceBridge = buildTizenServiceBridgeMarkup(
    includeEngineFsService || includePluginService
  );
  return `<!DOCTYPE html>
<html lang="en" class="no-flex-gap no-css-grid no-css-math no-backdrop-filter no-aspect-ratio">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=1920, height=1080, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${appName}</title>
  <script src="$WEBAPIS/webapis/webapis.js"></script>
  <script src="assets/runtime/legacy-features.js"></script>
${pluginServiceBridge}  <link rel="stylesheet" href="css/bundle.css" />
</head>
<body>
  <script src="boot-guard.js"></script>
  <script src="core-js.bundle.js" onerror="window.NuvioBootGuard &amp;&amp; window.NuvioBootGuard.scriptFailed(this.src)"></script>
  <script defer src="main.js" onerror="window.NuvioBootGuard &amp;&amp; window.NuvioBootGuard.scriptFailed(this.src)"></script>
</body>
</html>
`;
}

function buildMainJs({ packageId, includeEngineFsService, includePluginService }) {
  const engineFsServiceId = `${packageId}.EngineFsService`;
  const pluginServiceId = `${packageId}.PluginService`;
  const configuredServiceId = includeEngineFsService ? engineFsServiceId : "";
  const configuredPluginServiceId = includePluginService ? pluginServiceId : "";
  const compatibilityOptions = JSON.stringify({
    platform: "tizen",
    minVersion: Number.parseInt(compatibilityPolicy.tizenRequiredVersion, 10),
    minChrome: compatibilityPolicy.chromiumVersion,
    requiredLabel: `Samsung Tizen ${compatibilityPolicy.tizenRequiredVersion}+ · Chromium ${compatibilityPolicy.chromiumVersion}+ (${compatibilityPolicy.tizenSupportYear}+)`
  });
  return `window.__NUVIO_PLATFORM__ = "tizen";
window.__NUVIO_TIZEN_ENGINEFS_SERVICE_ENABLED__ = ${includeEngineFsService};
window.__NUVIO_TIZEN_ENGINEFS_SERVICE_ID__ = ${JSON.stringify(configuredServiceId)};
window.__NUVIO_TIZEN_PLUGIN_SERVICE_ENABLED__ = ${includePluginService};
window.__NUVIO_TIZEN_PLUGIN_SERVICE_ID__ = ${JSON.stringify(configuredPluginServiceId)};

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
  // The source runtime keeps a small alias so it can be tested in-place. A
  // Tizen package must contain the actual parser because the webOS source tree
  // is not part of the WGT.
  await cp(
    path.join(rootDir, "services", "webos", "src", "bitmapSubtitles.js"),
    path.join(
      stagingDir,
      `${tizenEngineFsRuntimeDirRelativePath}/embedded-text-subtitle-parser.cjs`
    )
  );
}

async function stageTizenPluginService() {
  await mkdir(path.join(stagingDir, "services"), { recursive: true });
  await Promise.all([
    cp(
      path.join(rootDir, tizenPluginServiceRelativePath),
      path.join(stagingDir, tizenPluginServiceRelativePath)
    ),
    cp(
      path.join(rootDir, tizenPluginServiceSourceRelativePath),
      path.join(stagingDir, tizenPluginServiceSourceRelativePath)
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

async function stagePackage({
  appId,
  packageId,
  version,
  envSourcePath,
  includeEngineFsService,
  includePluginService,
  serviceMetadataXml
}) {
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
      buildConfigXml({
        appId,
        packageId,
        version,
        includeEngineFsService,
        includePluginService,
        serviceMetadataXml
      }),
      "utf8"
    ),
    writeFile(
      path.join(stagingDir, "index.html"),
      buildIndexHtml({ includeEngineFsService, includePluginService }),
      "utf8"
    ),
    writeFile(
      path.join(stagingDir, "main.js"),
      buildMainJs({
        packageId,
        includeEngineFsService,
        includePluginService
      }),
      "utf8"
    )
  ]);
  if (includeEngineFsService) {
    await stageTizenEngineFsService();
  }
  if (includePluginService) {
    await stageTizenPluginService();
  }

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
  const storeBuild = isTruthy(process.env.TIZEN_STORE_BUILD);
  const configuredIncludeService = process.env.TIZEN_INCLUDE_ENGINEFS_SERVICE;
  const configuredIncludePluginService = process.env.TIZEN_INCLUDE_PLUGIN_SERVICE;
  const options = {
    outDir: rootDir,
    appId: process.env.TIZEN_APP_ID || defaultTizenAppId,
    packageId: process.env.TIZEN_PACKAGE_ID || defaultTizenPackageId,
    envSourcePath: process.env.TIZEN_ENV_SOURCE || "",
    storeBuild,
    includeEngineFsService:
      configuredIncludeService == null ? true : isTruthy(configuredIncludeService),
    includePluginService:
      configuredIncludePluginService == null ? true : isTruthy(configuredIncludePluginService),
    signingProfile: process.env.TIZEN_SECURITY_PROFILE || "",
    tizenCli: process.env.TIZEN_CLI || "tizen",
    serviceMetadataXml: String(process.env.TIZEN_SERVICE_METADATA_XML || "").trim()
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
    } else if (arg === "--store") {
      options.storeBuild = true;
    } else if (arg === "--include-enginefs-service") {
      options.includeEngineFsService = true;
    } else if (arg === "--no-enginefs-service") {
      options.includeEngineFsService = false;
    } else if (arg === "--include-plugin-service") {
      options.includePluginService = true;
    } else if (arg === "--no-plugin-service") {
      options.includePluginService = false;
    } else if (arg === "--sign-profile") {
      options.signingProfile = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--tizen-cli") {
      options.tizenCli = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--service-metadata") {
      options.serviceMetadataXml = String(argv[index + 1] || "").trim();
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.appId || !options.packageId) {
    throw new Error("Tizen app id and package id are required.");
  }

  if (options.storeBuild && !options.signingProfile) {
    throw new Error(
      "Tizen Store packaging requires an official Tizen security profile. " +
        "Provide TIZEN_SECURITY_PROFILE or --sign-profile."
    );
  }

  validateStoreServiceOptions(options);

  return options;
}

function runCommand(command, args, { cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(
          new Error(
            `Tizen CLI not found at "${command}". Install Tizen Studio/Web CLI on the packaging runner or set TIZEN_CLI to its executable path.`
          )
        );
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const details = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
      reject(new Error(`Tizen CLI package command failed with exit code ${code}. ${details}`));
    });
  });
}

async function findWgtFiles(directory) {
  if (!(await pathExists(directory))) {
    return [];
  }
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".wgt"))
    .map((entry) => path.join(directory, entry.name));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readTizenPackageId(configXml) {
  const match = String(configXml || "").match(
    /<tizen:application\b[^>]*\bpackage=["']([^"']+)["']/i
  );
  return match ? match[1] : "";
}

function hasTizenServiceEntry(configXml, serviceId, contentPath) {
  const escapedServiceId = escapeRegExp(serviceId);
  const escapedContentPath = escapeRegExp(contentPath);
  return new RegExp(
    `<tizen:service\\b(?=[^>]*\\bid=["']${escapedServiceId}["'])[^>]*>[\\s\\S]*?<tizen:content\\b[^>]*\\bsrc=["']${escapedContentPath}["'][\\s\\S]*?<\\/tizen:service\\s*>`,
    "i"
  ).test(String(configXml || ""));
}

function assertTizenStoragePrivilege(configXml) {
  if (
    !/<tizen:privilege\s+name=["']http:\/\/tizen\.org\/privilege\/unlimitedstorage["']/i.test(
      configXml
    )
  ) {
    throw new Error(
      "Tizen WGT config.xml is missing the unlimitedstorage privilege required by the IndexedDB plugin-code cache."
    );
  }
}

function assertTizenServiceManifest(
  configXml,
  { requireEngineFsService = false, requirePluginService = false } = {}
) {
  const packageId = readTizenPackageId(configXml);
  if ((requireEngineFsService || requirePluginService) && !packageId) {
    throw new Error("Tizen WGT config.xml is missing the application package id.");
  }

  const missingManifestEntry = [];
  if (requireEngineFsService || requirePluginService) {
    if (!/<feature\s+name=["']http:\/\/tizen\.org\/feature\/web\.service["']/i.test(configXml)) {
      missingManifestEntry.push("web.service feature");
    }
    if (
      !/<tizen:privilege\s+name=["']http:\/\/tizen\.org\/privilege\/application\.launch["']/i.test(
        configXml
      )
    ) {
      missingManifestEntry.push("application.launch privilege");
    }
  }
  if (
    requireEngineFsService &&
    !hasTizenServiceEntry(
      configXml,
      `${packageId}.EngineFsService`,
      tizenEngineFsServiceRelativePath
    )
  ) {
    missingManifestEntry.push("EngineFS service declaration");
  }
  if (
    requirePluginService &&
    !hasTizenServiceEntry(configXml, `${packageId}.PluginService`, tizenPluginServiceRelativePath)
  ) {
    missingManifestEntry.push("Plugin service declaration");
  }
  if (missingManifestEntry.length) {
    throw new Error(
      `Tizen WGT config.xml is missing required service metadata: ${missingManifestEntry.join(", ")}.`
    );
  }
  return packageId;
}

function requiredTizenServiceFiles({
  requireEngineFsService = false,
  requirePluginService = false
}) {
  return [
    ...(requireEngineFsService
      ? [
          tizenEngineFsServiceRelativePath,
          `${tizenEngineFsRuntimeDirRelativePath}/media-http.cjs`,
          `${tizenEngineFsRuntimeDirRelativePath}/playback-proxy-patch.cjs`,
          `${tizenEngineFsRuntimeDirRelativePath}/tx3g-subtitle-parser.cjs`,
          `${tizenEngineFsRuntimeDirRelativePath}/tx3g-subtitle-service.cjs`,
          `${tizenEngineFsRuntimeDirRelativePath}/embedded-text-subtitle-parser.cjs`
        ]
      : []),
    ...(requirePluginService
      ? [tizenPluginServiceRelativePath, tizenPluginServiceSourceRelativePath]
      : [])
  ];
}

async function assertTizenServicePackage(
  outputPath,
  { requireEngineFsService = false, requirePluginService = false } = {}
) {
  const zip = await JSZip.loadAsync(await readFile(outputPath));
  const configEntry = zip.file("config.xml");
  if (!configEntry) {
    throw new Error("Tizen WGT is missing config.xml.");
  }
  const configXml = await configEntry.async("string");
  assertTizenStoragePrivilege(configXml);
  const packageId = assertTizenServiceManifest(configXml, {
    requireEngineFsService,
    requirePluginService
  });

  const missingServiceEntry = requiredTizenServiceFiles({
    requireEngineFsService,
    requirePluginService
  }).find((fileName) => !zip.file(fileName));
  if (missingServiceEntry) {
    throw new Error(`Tizen WGT is missing the packaged service file ${missingServiceEntry}.`);
  }

  if (requireEngineFsService || requirePluginService) {
    const mainEntry = zip.file("main.js");
    if (!mainEntry) {
      throw new Error("Tizen WGT is missing main.js for the packaged service identifiers.");
    }
    const mainJs = await mainEntry.async("string");
    if (
      requireEngineFsService &&
      !/__NUVIO_TIZEN_ENGINEFS_SERVICE_ENABLED__\s*=\s*true\b/.test(mainJs)
    ) {
      throw new Error("Tizen WGT main.js does not enable the EngineFS service.");
    }
    if (
      requirePluginService &&
      !/__NUVIO_TIZEN_PLUGIN_SERVICE_ENABLED__\s*=\s*true\b/.test(mainJs)
    ) {
      throw new Error("Tizen WGT main.js does not enable the PluginService.");
    }
    if (
      requireEngineFsService &&
      !mainJs.includes(JSON.stringify(`${packageId}.EngineFsService`))
    ) {
      throw new Error(
        `Tizen WGT main.js does not reference the declared EngineFS service id ${packageId}.EngineFsService.`
      );
    }
    if (requirePluginService && !mainJs.includes(JSON.stringify(`${packageId}.PluginService`))) {
      throw new Error(
        `Tizen WGT main.js does not reference the declared PluginService id ${packageId}.PluginService.`
      );
    }
    if (requireEngineFsService && /11470|11471/.test(mainJs)) {
      throw new Error("Tizen WGT EngineFS/PluginService must not contain fallback ports.");
    }
  }

  if (requireEngineFsService || requirePluginService) {
    const indexEntry = zip.file("index.html");
    if (!indexEntry) {
      throw new Error("Tizen WGT is missing index.html for the Tizen service bridge.");
    }
    const indexHtml = await indexEntry.async("string");
    if (
      !/<script\s+type=["']module["']>\s*import\s+\*\s+as\s+service\s+from\s+["']wrt:service["'];/is.test(
        indexHtml
      )
    ) {
      throw new Error("Tizen WGT is missing the inline wrt:service module bridge.");
    }
  }

  if (requirePluginService) {
    const pluginServiceEntry = zip.file(tizenPluginServiceRelativePath);
    const pluginServiceSource = await pluginServiceEntry.async("string");
    const pluginHttpEntry = zip.file(tizenPluginServiceSourceRelativePath);
    if (!pluginHttpEntry) {
      throw new Error(
        `Tizen WGT is missing the packaged PluginService helper ${tizenPluginServiceSourceRelativePath}.`
      );
    }
    const pluginHttpSource = await pluginHttpEntry.async("string");
    // Reject the experimental transport even if its old diagnostic marker is absent.
    // EngineFS remains a separate service and must not replace plugin HTTPS.
    if (
      /nuvio-enginefs-fetch|plugin-network\.cjs|createLazyEngineFsTransport|rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/.test(
        pluginServiceSource + "\n" + pluginHttpSource
      )
    ) {
      throw new Error(
        "Tizen PluginService must retain its native certificate-verifying transport."
      );
    }
    if (!pluginServiceSource.includes('require("../plugin-http.cjs")')) {
      throw new Error(
        "Tizen WGT PluginService must use the canonical relative plugin-http module."
      );
    }
    if (
      /NUVIO_TIZEN_PLUGIN_(HTTP|FETCH)_BUNDLED|tizen55BundledFetchFactory/.test(pluginServiceSource)
    ) {
      throw new Error(
        "Tizen WGT PluginService must not contain the removed Tizen 5.5 compatibility bundle."
      );
    }
    if (!pluginHttpSource.includes("function createPluginHttpServer(")) {
      throw new Error("Tizen WGT PluginService helper is missing createPluginHttpServer.");
    }
    if (/legacyTizen55|allowInsecureTls|tizen-5\.5/i.test(pluginHttpSource)) {
      throw new Error(
        "Tizen WGT PluginService helper must not contain removed Tizen 5.5 compatibility logic."
      );
    }
    if (!pluginServiceSource.includes(`var DEFAULT_PORT = ${tizenPluginServicePort};`)) {
      throw new Error("Tizen WGT PluginService must use the fixed port 2711.");
    }
    if (/FALLBACK_PORT|candidateIndex/.test(pluginServiceSource)) {
      throw new Error("Tizen WGT PluginService must not contain a fallback port.");
    }
  }

  if (requireEngineFsService) {
    const engineFsEntry = zip.file(tizenEngineFsServiceRelativePath);
    const engineFsSource = await engineFsEntry.async("string");
    if (
      !new RegExp(
        `process\\.env\\.PORT\\s*=\\s*process\\.env\\.PORT\\s*\\|\\|\\s*["']${tizenEngineFsServicePort}["']`
      ).test(engineFsSource)
    ) {
      throw new Error("Tizen WGT EngineFS must use the fixed port 2710.");
    }
    if (/11470|11471|FALLBACK_PORT|candidateIndex/.test(engineFsSource)) {
      throw new Error("Tizen WGT EngineFS/PluginService must not contain fallback ports.");
    }
    if (requirePluginService) {
      if (/require\(["']\.\/plugin-service\.js["']\)/.test(engineFsSource)) {
        throw new Error("Tizen WGT EngineFS and PluginService must remain independent.");
      }
    }
  }
}

async function assertSignedTizenPackage(
  outputPath,
  { requireEngineFsService = false, requirePluginService = false } = {}
) {
  const zip = await JSZip.loadAsync(await readFile(outputPath));
  const requiredFiles = ["config.xml", "author-signature.xml", "signature1.xml"];
  for (const fileName of requiredFiles) {
    const entry = zip.file(fileName);
    if (!entry) {
      throw new Error(`Signed Tizen WGT is missing required ${fileName}.`);
    }
  }

  const configXml = await zip.file("config.xml").async("string");
  if (/auto-restart\s*=\s*["']true["']/i.test(configXml)) {
    throw new Error(
      'Tizen WGT contains auto-restart="true", which is not allowed for Store submission.'
    );
  }
  if (/on-boot\s*=\s*["']true["']/i.test(configXml)) {
    throw new Error(
      'Tizen WGT contains on-boot="true", which is not allowed for Store submission.'
    );
  }
  await assertTizenServicePackage(outputPath, {
    requireEngineFsService,
    requirePluginService
  });
}

async function packageWithOfficialTizenCli({
  outputPath,
  signingProfile,
  tizenCli,
  requireEngineFsService,
  requirePluginService
}) {
  await rm(signedOutputDir, { recursive: true, force: true });
  await mkdir(signedOutputDir, { recursive: true });
  await runCommand(tizenCli, ["package", "-t", "wgt", "-s", signingProfile, "--", stagingDir], {
    cwd: signedOutputDir
  });

  const candidates = [
    ...(await findWgtFiles(signedOutputDir)),
    ...(await findWgtFiles(stagingDir))
  ];
  if (candidates.length === 0) {
    throw new Error(
      `Tizen CLI completed without producing a WGT in ${signedOutputDir}. Check the installed CLI version and security profile.`
    );
  }

  const [signedPackagePath] = candidates;
  await cp(signedPackagePath, outputPath);
  await assertSignedTizenPackage(outputPath, {
    requireEngineFsService,
    requirePluginService
  });
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
  await rm(outputPath, { force: true });

  if (options.storeBuild) {
    await packageWithOfficialTizenCli({
      outputPath,
      signingProfile: options.signingProfile,
      tizenCli: options.tizenCli,
      requireEngineFsService: options.storeBuild,
      requirePluginService: options.storeBuild
    });
  } else {
    const zip = new JSZip();
    await addDirectoryToZip(zip, stagingDir);
    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE"
    });
    await writeFile(outputPath, buffer);
    await assertTizenServicePackage(outputPath, {
      requireEngineFsService: options.includeEngineFsService,
      requirePluginService: options.includePluginService
    });
  }

  console.log(`Tizen WGT created: ${outputPath}`);
  console.log(`Tizen application id: ${options.appId}`);
  console.log(`Tizen package id: ${options.packageId}`);
  console.log(
    `Tizen package profile: ${options.storeBuild ? "official Store-signed" : "development (unsigned)"}`
  );
  console.log(`Tizen EngineFS service packaged: ${options.includeEngineFsService ? "yes" : "no"}`);
  console.log(`Tizen Plugin service packaged: ${options.includePluginService ? "yes" : "no"}`);
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
