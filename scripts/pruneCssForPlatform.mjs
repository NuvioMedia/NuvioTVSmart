import { readFile, writeFile } from "node:fs/promises";
import postcss from "postcss";

// Each package forces window.__NUVIO_PLATFORM__, so these classes can never be set on the
// other platform (see applyPerformanceMode in js/app.js and the Tizen adapter).
const FOREIGN_PLATFORM_CLASSES = {
  webos: /\.(?:legacy-tizen|tizen-tv)(?![\w-])/,
  tizen: /\.(?:legacy-webos|legacy-webos38|webos-unpromoted-home-tracks)(?![\w-])/
};

export function pruneCssForPlatform(css, platform) {
  const foreignClass = FOREIGN_PLATFORM_CLASSES[platform];
  if (!foreignClass) {
    throw new Error(`Unknown CSS pruning platform: ${platform}`);
  }
  const root = postcss.parse(css);
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) {
      return;
    }
    // Selectors with :not() can match precisely because the class is absent, so keep them.
    const kept = rule.selectors.filter(
      (selector) => selector.includes(":not(") || !foreignClass.test(selector)
    );
    if (kept.length === rule.selectors.length) {
      return;
    }
    if (kept.length) {
      rule.selectors = kept;
    } else {
      rule.remove();
    }
  });
  root.walkAtRules((atRule) => {
    if (atRule.nodes && !atRule.nodes.length) {
      atRule.remove();
    }
  });
  return root.toString();
}

export async function pruneCssFileForPlatform(filePath, platform) {
  const css = await readFile(filePath, "utf8");
  await writeFile(filePath, pruneCssForPlatform(css, platform), "utf8");
}
