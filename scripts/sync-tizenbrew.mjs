import { access, cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { constants as fsConstants } from "node:fs";
import { compatibilityPolicy } from "./compatibilityPolicy.mjs";
import { writeRuntimeEnvScriptFile } from "./envProperties.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const appName = "Nuvio TV";
const tizenIconSource = path.join(rootDir, "assets", "images", "tizenIcon.png");

function fail(message) {
  throw new Error(
    `${message}\n\nUsage: node ./scripts/sync-tizenbrew.mjs --path /absolute/path/to/module`
  );
}

function parseArgs(argv) {
  let targetPath = "";
  let envSourcePath = "";
  const positionalArgs = [];
  const npmConfigPath = process.env.npm_config_path;
  const npmProvidedPath = npmConfigPath && npmConfigPath !== "true" ? npmConfigPath : "";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--path") {
      targetPath = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (arg === "--env-source") {
      envSourcePath = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (!arg.startsWith("--")) {
      positionalArgs.push(arg);
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (!targetPath) {
    targetPath = positionalArgs[0] || npmProvidedPath || "";
  }

  if (!targetPath) {
    fail("Missing --path.");
  }

  if (!path.isAbsolute(targetPath)) {
    fail(`Target path must be absolute: ${targetPath}`);
  }

  if (envSourcePath && !path.isAbsolute(envSourcePath)) {
    fail(`Env source path must be absolute: ${envSourcePath}`);
  }

  return {
    targetDir: targetPath,
    envSourcePath
  };
}

async function assertDistExists() {
  try {
    await access(distDir, fsConstants.R_OK);
  } catch {
    throw new Error(`Build output not found at ${distDir}. Run "npm run build" first.`);
  }
}

async function syncFolder(targetDir, folderName) {
  await rm(path.join(targetDir, folderName), { recursive: true, force: true });
  await cp(path.join(distDir, folderName), path.join(targetDir, folderName), { recursive: true });
}

async function syncOptionalFolder(targetDir, folderName) {
  try {
    await access(path.join(distDir, folderName), fsConstants.R_OK);
  } catch {
    await rm(path.join(targetDir, folderName), { recursive: true, force: true });
    return;
  }
  await syncFolder(targetDir, folderName);
}

async function syncBuild(targetAppDir, envSourcePath) {
  await mkdir(targetAppDir, { recursive: true });
  await Promise.all([
    syncFolder(targetAppDir, "assets"),
    syncFolder(targetAppDir, "css"),
    syncOptionalFolder(targetAppDir, "js"),
    syncFolder(targetAppDir, "res")
  ]);

  await cp(path.join(distDir, "app.bundle.js"), path.join(targetAppDir, "app.bundle.js"));
  await cp(path.join(distDir, "core-js.bundle.js"), path.join(targetAppDir, "core-js.bundle.js"));
  await cp(path.join(distDir, "boot-guard.js"), path.join(targetAppDir, "boot-guard.js"));
  await cp(path.join(distDir, "youtube-proxy.html"), path.join(targetAppDir, "youtube-proxy.html"));
  if (envSourcePath) {
    await writeRuntimeEnvScriptFile(path.join(targetAppDir, "nuvio.env.js"), {
      rootDir,
      sourcePath: envSourcePath
    });
  } else {
    try {
      await cp(path.join(distDir, "nuvio.env.js"), path.join(targetAppDir, "nuvio.env.js"));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      await writeRuntimeEnvScriptFile(path.join(targetAppDir, "nuvio.env.js"), { rootDir });
    }
  }
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

function buildMainJs() {
  const compatibilityOptions = JSON.stringify({
    platform: "tizen",
    minVersion: Number.parseInt(compatibilityPolicy.tizenRequiredVersion, 10),
    minChrome: compatibilityPolicy.chromiumVersion,
    requiredLabel: `Samsung Tizen ${compatibilityPolicy.tizenRequiredVersion}+ · Chromium ${compatibilityPolicy.chromiumVersion}+ (${compatibilityPolicy.tizenSupportYear}+)`
  });
  return `window.__NUVIO_PLATFORM__ = "tizen";

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
  loadScript("js/runtime/env.js");
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

async function syncModule(targetDir, envSourcePath) {
  const appDir = path.join(targetDir, "app");
  await mkdir(targetDir, { recursive: true });
  await syncBuild(appDir, envSourcePath);
  await cp(tizenIconSource, path.join(targetDir, "icon.png"));
  await writeFile(path.join(appDir, "index.html"), buildIndexHtml(), "utf8");
  await writeFile(path.join(appDir, "main.js"), buildMainJs(), "utf8");
}

const { targetDir, envSourcePath } = parseArgs(process.argv.slice(2));
await assertDistExists();
await syncModule(targetDir, envSourcePath);

console.log(`Synced TizenBrew module assets to ${targetDir}`);
