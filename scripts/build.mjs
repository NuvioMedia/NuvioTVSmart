import { cp, mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import coreJsCompat from "core-js-compat";
import postcssGlobalData from "@csstools/postcss-global-data";
import postcss from "postcss";
import cssnano from "cssnano";
import autoprefixer from "autoprefixer";
import { readAppMetadata, syncVersionFiles } from "./appMetadata.mjs";
import { compatibilityPolicy } from "./compatibilityPolicy.mjs";
import { writeRuntimeEnvScriptFile } from "./envProperties.mjs";
import { buildI18nBundles } from "./buildI18nBundles.mjs";
import { assSubtitleRuntimeSource } from "./assSubtitleRuntime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const requireConfiguredRuntimeEnv = /^(1|true|yes|on)$/i.test(
  String(process.env.NUVIO_REQUIRE_LOCAL_PROPERTIES || "")
);
const debugBundle = /^(1|true|yes|on)$/i.test(String(process.env.NUVIO_DEBUG_BUNDLE || ""));
const legacyViewport = {
  width: 1920,
  height: 1080,
  remPx: 20
};
const rgbVariableFallbacks = {
  "--bg-color-rgb": "13 13 13",
  "--bg-elevated-rgb": "26 26 26",
  "--card-bg-rgb": "34 34 34",
  "--secondary-color-rgb": "245 245 245",
  "--focus-color-rgb": "255 255 255"
};

function splitTopLevelSpaces(value) {
  const parts = [];
  let current = "";
  let depth = 0;

  for (const char of value) {
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    }

    if (/\s/.test(char) && depth === 0) {
      if (current.trim()) {
        parts.push(current.trim());
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function splitFunctionArgs(value) {
  const args = [];
  let current = "";
  let depth = 0;

  for (const char of value) {
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    }

    if (char === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    args.push(current.trim());
  }

  return args;
}

function toLegacyLengthValue(value) {
  let result = value.trim();
  let changed = true;

  while (changed) {
    changed = false;
    result = result.replace(
      /\b(min|max|clamp)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g,
      (match, fn, argsText) => {
        const args = splitFunctionArgs(argsText).map(toLegacyLengthValue);
        const computed = computeLegacyMathValue(fn, args);
        const replacement =
          computed ||
          (fn === "clamp" ? args[2] || args[1] || args[0] : chooseStaticMathFallback(fn, args));
        changed = true;
        return replacement || match;
      }
    );
  }

  return result;
}

function parseLengthToPx(value) {
  const match = String(value || "")
    .trim()
    .match(/^(-?\d*\.?\d+)(px|vw|vh|rem)$/i);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(amount)) {
    return null;
  }
  if (unit === "px") {
    return amount;
  }
  if (unit === "vw") {
    return (amount * legacyViewport.width) / 100;
  }
  if (unit === "vh") {
    return (amount * legacyViewport.height) / 100;
  }
  if (unit === "rem") {
    return amount * legacyViewport.remPx;
  }
  return null;
}

function formatPx(value) {
  const rounded = Math.round(value * 1000) / 1000;
  return `${String(rounded)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1")}px`;
}

function computeLegacyMathValue(fn, args) {
  const values = args.map(parseLengthToPx);
  if (values.some((value) => value === null)) {
    return "";
  }

  if (fn === "min") {
    return formatPx(Math.min(...values));
  }
  if (fn === "max") {
    return formatPx(Math.max(...values));
  }
  if (fn === "clamp") {
    const min = values[0];
    const preferred = values[1] ?? min;
    const max = values[2] ?? preferred;
    return formatPx(Math.max(min, Math.min(max, preferred)));
  }
  return "";
}

function chooseStaticMathFallback(fn, args) {
  const parseable = args
    .map((value) => ({ value, px: parseLengthToPx(value) }))
    .filter((entry) => entry.px !== null);
  if (!parseable.length) {
    return args[args.length - 1] || "";
  }
  if (fn === "max") {
    return parseable.reduce((max, entry) => (entry.px > max.px ? entry : max), parseable[0]).value;
  }
  if (fn === "min") {
    return parseable.reduce((min, entry) => (entry.px < min.px ? entry : min), parseable[0]).value;
  }
  return args[2] || args[1] || args[0] || "";
}

function splitRgbChannels(channels) {
  const parts = String(channels || "")
    .trim()
    .split(/\s+/)
    .map((part) => Number(part));
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  return parts.slice(0, 3);
}

function toLegacyColorValue(value) {
  let result = String(value || "");

  result = result.replace(
    /\brgba?\(\s*var\((--[\w-]+)\)\s*\/\s*([^)]+?)\s*\)/g,
    (match, variableName, alpha) => {
      const channels = splitRgbChannels(rgbVariableFallbacks[variableName]);
      if (!channels) {
        return match;
      }
      return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha.trim()})`;
    }
  );

  result = result.replace(
    /\brgba?\(\s*(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s*\/\s*([^)]+?)\s*\)/g,
    (_match, red, green, blue, alpha) => `rgba(${red}, ${green}, ${blue}, ${alpha.trim()})`
  );

  return result;
}

function insertInsetFallbacks(decl) {
  if (decl.prop.toLowerCase() !== "inset") {
    return;
  }

  const values = splitTopLevelSpaces(decl.value);
  if (!values.length || values.length > 4) {
    return;
  }

  const top = values[0];
  const right = values[1] || top;
  const bottom = values[2] || top;
  const left = values[3] || right;
  const fallbacks = [
    ["top", top],
    ["right", right],
    ["bottom", bottom],
    ["left", left]
  ];

  for (const [prop, value] of fallbacks) {
    decl.cloneBefore({ prop, value });
  }
}

function legacyDeclarationFallbackPlugin() {
  const guardedDeclarations = new WeakSet();
  const lastGuardByRule = new WeakMap();
  return {
    postcssPlugin: "nuvio-legacy-declaration-fallbacks",
    Declaration(decl) {
      if (guardedDeclarations.has(decl)) return;
      insertInsetFallbacks(decl);

      const legacyValue = toLegacyColorValue(toLegacyLengthValue(decl.value));
      if (legacyValue && legacyValue !== decl.value) {
        // Custom properties accept unsupported math as tokens. A later var()
        // substitution then invalidates the consuming property, so duplicate
        // declarations alone cannot provide a legacy fallback.
        if (decl.prop.startsWith("--") && /\b(min|max|clamp)\(/.test(decl.value)) {
          const modernDecl = decl.clone();
          guardedDeclarations.add(modernDecl);
          const modernRule = decl.parent.clone({ nodes: [modernDecl] });
          const guard = postcss.atRule({
            name: "supports",
            params:
              "(width: min(1px, 2px)) and (width: max(1px, 2px)) and (width: clamp(1px, 2px, 3px))"
          });
          guard.append(modernRule);
          const previousGuard = lastGuardByRule.get(decl.parent);
          (previousGuard || decl.parent).after(guard);
          lastGuardByRule.set(decl.parent, guard);
          decl.value = legacyValue;
          return;
        }
        const previous = decl.prev();
        if (
          !previous ||
          previous.type !== "decl" ||
          previous.prop !== decl.prop ||
          previous.value !== legacyValue
        ) {
          decl.cloneBefore({ value: legacyValue });
        }
      }
    }
  };
}

legacyDeclarationFallbackPlugin.postcss = true;

function unsupportedSelectorFallbackPlugin() {
  return {
    postcssPlugin: "nuvio-unsupported-selector-fallbacks",
    Rule(rule) {
      if (!rule.selector || !rule.selectors?.length) {
        return;
      }

      const safeSelectors = rule.selectors.filter(
        (selector) => !selector.includes(":focus-visible") && !selector.includes(":has(")
      );
      if (!safeSelectors.length || safeSelectors.length === rule.selectors.length) {
        return;
      }

      const fallback = rule.clone({ selectors: safeSelectors });
      rule.before(fallback);
    }
  };
}

unsupportedSelectorFallbackPlugin.postcss = true;

function flexGapFallbackPlugin() {
  return {
    postcssPlugin: "nuvio-flex-gap-fallback",
    Rule(rule) {
      if (
        !rule.selector ||
        (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name))
      ) {
        return;
      }

      let displayFlex = false;
      let rowGap = null;
      let columnGap = null;
      let flexDirection = "row";
      let flexWrap = "nowrap";

      rule.walkDecls((decl) => {
        const prop = decl.prop.toLowerCase();
        if (prop === "display" && /\b(?:inline-)?flex\b/.test(decl.value)) {
          displayFlex = true;
          return;
        }

        if (prop === "flex-direction") {
          flexDirection = decl.value.toLowerCase();
          return;
        }

        if (prop === "flex-wrap") {
          flexWrap = decl.value.toLowerCase();
          return;
        }

        if (prop === "flex-flow") {
          const value = decl.value.toLowerCase();
          if (value.includes("column")) {
            flexDirection = "column";
          }
          if (value.includes("wrap")) {
            flexWrap = "wrap";
          }
          return;
        }

        if (prop === "gap") {
          const values = splitTopLevelSpaces(decl.value).map(toLegacyLengthValue);
          rowGap = values[0] || "0";
          columnGap = values[1] || rowGap;
          return;
        }

        if (prop === "row-gap") {
          rowGap = toLegacyLengthValue(decl.value);
          return;
        }

        if (prop === "column-gap") {
          columnGap = toLegacyLengthValue(decl.value);
        }
      });

      if (!displayFlex || (!rowGap && !columnGap)) {
        return;
      }

      rowGap ||= "0";
      columnGap ||= "0";

      const scopedSelectors = rule.selectors.map((selector) => `html.no-flex-gap ${selector}`);
      const isColumnDirection = flexDirection.includes("column");
      const wraps = flexWrap.includes("wrap") && !flexWrap.includes("nowrap");
      const childFallback = postcss.rule({
        selectors: scopedSelectors.map((selector) => `${selector} > * + *`)
      });

      if (isColumnDirection) {
        childFallback.append({ prop: "margin-top", value: rowGap });
      } else if (wraps) {
        childFallback.selectors = scopedSelectors.map((selector) => `${selector} > *`);
        childFallback.append({ prop: "margin-right", value: columnGap });
        childFallback.append({ prop: "margin-bottom", value: rowGap });
      } else {
        childFallback.append({ prop: "margin-left", value: columnGap });
      }

      rule.after(childFallback);
    }
  };
}

flexGapFallbackPlugin.postcss = true;

const BUNDLED_CSS_FILE = "bundle.css";

async function buildCSS() {
  console.log("processing CSS with PostCSS (legacy support)...");
  const cssDir = path.join(rootDir, "css");
  const distCssDir = path.join(distDir, "css");
  const outPath = path.join(distCssDir, BUNDLED_CSS_FILE);
  const files = await readdir(cssDir);

  const componentFiles = files
    .filter((file) => /^components-\d+\.css$/.test(file))
    .sort((a, b) => {
      const numA = Number(a.match(/^components-(\d+)\.css$/)[1]);
      const numB = Number(b.match(/^components-(\d+)\.css$/)[1]);
      return numA - numB;
    });

  // Preserve cascade order: tokens/base first, layout, components, then
  // any future stylesheets, with themes last so overrides win.
  const orderedFiles = ["base.css", "layout.css", ...componentFiles];
  const orderedSet = new Set([...orderedFiles, "components.css", BUNDLED_CSS_FILE]);
  const extraFiles = files
    .filter((file) => file.endsWith(".css") && !orderedSet.has(file) && file !== "themes.css")
    .sort();
  const finalOrder = [...orderedFiles, ...extraFiles, "themes.css"].filter((file) =>
    files.includes(file)
  );

  const remoteImports = [];
  const seenRemoteImports = new Set();
  const bodies = [];

  const remoteImportPattern =
    /@import\s+(?:url\(\s*["']?(https?:\/\/[^"')]+)["']?\s*\)|["'](https?:\/\/[^"']+)["'])\s*[^;]*;/gi;
  const localImportPattern =
    /@import\s+(?:url\(\s*["']?(\.{0,2}\/[^"')]+)["']?\s*\)|["'](\.{0,2}\/[^"']+)["'])\s*[^;]*;/gi;

  for (const file of finalOrder) {
    const raw = await readFile(path.join(cssDir, file), "utf8");

    for (const match of raw.matchAll(remoteImportPattern)) {
      const url = match[1] || match[2];
      if (url && !seenRemoteImports.has(url)) {
        seenRemoteImports.add(url);
        remoteImports.push(`@import url("${url}");`);
      }
    }

    // Strip all @imports: remote ones are hoisted above, local ones are
    // inlined by this concatenation (e.g. components.css manifest).
    const body = raw.replace(remoteImportPattern, "").replace(localImportPattern, "").trim();
    if (body) {
      const result = await postcss([
        postcssGlobalData({ files: [path.join(cssDir, "base.css")] }),
        autoprefixer({
          overrideBrowserslist: [`Chrome ${compatibilityPolicy.chromiumVersion}`],
          grid: "autoplace"
        }),
        legacyDeclarationFallbackPlugin(),
        unsupportedSelectorFallbackPlugin(),
        flexGapFallbackPlugin(),
        cssnano()
      ]).process(`/* ${file} */\n${body}`, {
        from: path.join(cssDir, file),
        to: outPath
      });

      bodies.push(result.css);
    }
  }

  const concatenated = [...remoteImports, ...bodies].filter(Boolean).join("\n\n");

  // Only the single bundled file is part of the build output.
  await rm(distCssDir, { recursive: true, force: true });
  await mkdir(distCssDir, { recursive: true });
  await writeFile(outPath, concatenated);
}

async function copyOptionalRootFile(fileName, { fallback = null, defaultContents = "" } = {}) {
  const targetPath = path.join(distDir, fileName);
  try {
    await cp(path.join(rootDir, fileName), targetPath);
    return fileName;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  if (!fallback) {
    return "";
  }

  try {
    await cp(path.join(rootDir, fallback), targetPath);
    return fallback;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  await writeFile(targetPath, defaultContents, "utf8");
  return "generated-default";
}

async function buildCoreJsBundle() {
  console.log("building core-js bundle...");
  const { list: requiredModules } = coreJsCompat({
    modules: ["core-js/stable"],
    targets: { chrome: String(compatibilityPolicy.chromiumVersion) }
  });
  if (requiredModules.length === 0) {
    throw new Error("Core-js compatibility query returned no required modules.");
  }
  await build({
    stdin: {
      contents: requiredModules
        .map((moduleName) => `import "core-js/modules/${moduleName}.js";`)
        .join("\n"),
      resolveDir: rootDir,
      sourcefile: "core-js-entry.js"
    },
    outfile: path.join(distDir, "core-js.bundle.js"),
    bundle: true,
    format: "iife",
    minify: !debugBundle,
    target: [`chrome${compatibilityPolicy.chromiumVersion}`],
    legalComments: "none"
  });
}

async function buildAssSubtitleLibrary() {
  await build({
    stdin: {
      contents: await assSubtitleRuntimeSource(rootDir),
      resolveDir: rootDir,
      sourcefile: "ass-runtime.js"
    },
    bundle: true,
    format: "iife",
    outfile: path.join(distDir, "assets", "libs", "ass.min.js"),
    minify: !debugBundle,
    target: [`chrome${compatibilityPolicy.chromiumVersion}`],
    legalComments: "none"
  });
}

async function buildPluginRuntimeAssets() {
  console.log("building isolated JavaScript plugin runtime...");
  await mkdir(path.join(distDir, "assets", "libs"), { recursive: true });
  await mkdir(path.join(distDir, "assets", "runtime"), { recursive: true });
  const cryptoJsSource = await readFile(
    path.join(rootDir, "node_modules", "crypto-js", "crypto-js.js"),
    "utf8"
  );
  await build({
    entryPoints: [
      path.join(rootDir, "node_modules", "quickjs-emscripten", "dist", "index.global.js")
    ],
    outfile: path.join(distDir, "assets", "libs", "quickjs-emscripten.global.js"),
    bundle: false,
    target: [`chrome${compatibilityPolicy.chromiumVersion}`],
    minify: !debugBundle,
    legalComments: "none"
  });
  await build({
    entryPoints: [path.join(rootDir, "js", "core", "player", "pluginWorker.js")],
    outfile: path.join(distDir, "assets", "runtime", "plugin-worker.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: [`chrome${compatibilityPolicy.chromiumVersion}`],
    minify: !debugBundle,
    legalComments: "none",
    define: {
      __NUVIO_CRYPTO_JS_SOURCE__: JSON.stringify(cryptoJsSource)
    }
  });
  await cp(
    path.join(rootDir, "node_modules", "quickjs-emscripten", "LICENSE"),
    path.join(distDir, "assets", "libs", "quickjs-emscripten.LICENSE")
  );
  await cp(
    path.join(rootDir, "node_modules", "crypto-js", "LICENSE"),
    path.join(distDir, "assets", "libs", "crypto-js.LICENSE")
  );
}

async function buildBundle() {
  const { version } = await readAppMetadata();

  console.log("starting bundle build...");
  const result = await build({
    entryPoints: [path.join(rootDir, "js/app.js")],
    outfile: path.join(distDir, "app.bundle.js"),
    bundle: true,
    minify: !debugBundle,
    format: "iife",
    sourcemap: debugBundle,
    target: [`chrome${compatibilityPolicy.chromiumVersion}`],
    metafile: true,
    define: {
      "process.env.NODE_ENV": '"production"',
      __NUVIO_APP_VERSION__: JSON.stringify(version)
    }
  });
  if (
    Object.keys(result.metafile.inputs).some((input) => input.includes("node_modules/core-js/"))
  ) {
    throw new Error("Application bundle must not contain core-js modules.");
  }
  console.log("bundle build complete");
}
async function runBuild() {
  try {
    console.log("cleaning dist directory...");
    await rm(distDir, { recursive: true, force: true });
    await mkdir(distDir, { recursive: true });

    console.log("building version files...");
    await syncVersionFiles();
    await buildCSS();

    console.log("copying static assets...");
    const copiedAppInfoSource = await copyOptionalRootFile("appinfo.json");
    await Promise.all([
      cp(path.join(rootDir, "assets"), path.join(distDir, "assets"), { recursive: true }),
      cp(path.join(rootDir, "res"), path.join(distDir, "res"), { recursive: true }),
      cp(path.join(rootDir, "boot-guard.js"), path.join(distDir, "boot-guard.js")),
      cp(path.join(rootDir, "docs", "youtube-proxy.html"), path.join(distDir, "youtube-proxy.html"))
    ]);
    await buildI18nBundles({ rootDir, distDir });
    await buildCoreJsBundle();
    await Promise.all([
      cp(
        path.join(rootDir, "node_modules", "hls.js", "dist", "hls.min.js"),
        path.join(distDir, "assets", "libs", "hls.min.js")
      ),
      cp(
        path.join(rootDir, "node_modules", "hls.js", "LICENSE"),
        path.join(distDir, "assets", "libs", "hls.js.LICENSE")
      ),
      cp(
        path.join(rootDir, "node_modules", "dashjs", "dist", "legacy", "umd", "dash.all.min.js"),
        path.join(distDir, "assets", "libs", "dash.all.min.js")
      ),
      cp(
        path.join(rootDir, "node_modules", "dashjs", "LICENSE.md"),
        path.join(distDir, "assets", "libs", "dashjs.LICENSE.md")
      ),
      cp(
        path.join(rootDir, "node_modules", "assjs", "LICENSE"),
        path.join(distDir, "assets", "libs", "assjs.LICENSE")
      )
    ]);
    await buildAssSubtitleLibrary();
    await buildPluginRuntimeAssets();
    await cp(
      path.join(rootDir, "node_modules", "libbitsub", "pkg", "libbitsub_bg.wasm"),
      path.join(distDir, "assets", "libs", "libbitsub_bg.wasm")
    );
    await cp(
      path.join(rootDir, "node_modules", "libbitsub", "LICENSE"),
      path.join(distDir, "assets", "libs", "libbitsub.LICENSE")
    );

    if (!copiedAppInfoSource) {
      console.warn("WARNING: skipping appinfo.json because it is not present in the repo root.");
    }

    // js bundle processing (final step to ensure all transformations are applied correctly and we end up with a single, minified bundle file)
    await buildBundle();

    const sourceIndex = await readFile(path.join(rootDir, "index.html"), "utf8");
    // The build ships a single concatenated stylesheet. Rewrite any legacy
    // per-file css/<name>.css references to the bundled output so dist
    // always points at the one file, even if the source still lists several.
    let injectedBundledCss = false;
    const bundledIndex = sourceIndex.replace(
      /[ \t]*<link\s+rel="stylesheet"\s+href="css\/[^"]*"(?:\s*\/?)>[ \t]*\r?\n?/gi,
      () => {
        if (!injectedBundledCss) {
          injectedBundledCss = true;
          return `    <link rel="stylesheet" href="css/${BUNDLED_CSS_FILE}" />\n`;
        }
        return "";
      }
    );
    await writeFile(path.join(distDir, "index.html"), bundledIndex);

    console.log("configuring runtime env from local.properties...");
    const envResult = await writeRuntimeEnvScriptFile(path.join(distDir, "nuvio.env.js"), {
      rootDir
    });
    const envSourceBaseName = path.basename(envResult.sourcePath || "");
    const usingFallbackEnv =
      !envResult.sourcePath || envSourceBaseName === "local.example.properties";
    if (requireConfiguredRuntimeEnv && usingFallbackEnv) {
      throw new Error(
        "Configured runtime env is required for this build. Provide local.properties."
      );
    }
    if (!envResult.sourcePath) {
      console.warn("WARNING: generated default runtime env (unconfigured).");
    } else if (envSourceBaseName === "local.example.properties") {
      console.warn("WARNING: using local.example.properties as fallback.");
    }

    console.log(`\nbuild finished successfully in: ${distDir}`);
  } catch (error) {
    console.error("\nbuild failed:");
    console.error(error);
    process.exit(1);
  }
}

runBuild();
