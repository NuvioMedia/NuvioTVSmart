import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pruneCssForPlatform } from "./pruneCssForPlatform.mjs";

const fixture = `
.a{color:red}
.legacy-tizen .b,.c{color:blue}
.tizen-tv .d{color:green}
html:not(.legacy-tizen) .e{color:black}
.legacy-webos .f{color:red}
.legacy-webos38 .g{color:red}
.legacy-webosx .h{color:red}
@media (min-width:1px){.legacy-tizen .i{color:red}}
@keyframes k{0%{opacity:0}to{opacity:1}}
`;

const webos = pruneCssForPlatform(fixture, "webos");
assert.match(webos, /\.a\{color:red\}/);
assert.match(webos, /\.c\{color:blue\}/);
assert.doesNotMatch(webos, /\.legacy-tizen \.b|\.tizen-tv|\.legacy-tizen \.i|@media/);
assert.match(webos, /html:not\(\.legacy-tizen\) \.e/);
assert.match(webos, /\.legacy-webos \.f/);
assert.match(webos, /@keyframes k/);

const tizen = pruneCssForPlatform(fixture, "tizen");
assert.doesNotMatch(tizen, /\.legacy-webos \.f|\.legacy-webos38/);
assert.match(tizen, /\.legacy-webosx \.h/);
assert.match(tizen, /\.legacy-tizen \.b,\s*\.c/);
assert.match(tizen, /\.tizen-tv \.d/);

const bundlePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
  "css",
  "bundle.css"
);
const bundle = await readFile(bundlePath, "utf8").catch(() => "");
if (bundle) {
  const prunedWebOs = pruneCssForPlatform(bundle, "webos");
  const prunedTizen = pruneCssForPlatform(bundle, "tizen");
  assert.ok(prunedWebOs.length < bundle.length && prunedTizen.length < bundle.length);
  // Same-platform rules must survive untouched.
  assert.equal(
    (prunedWebOs.match(/\.legacy-webos(?![\w-])/g) || []).length,
    (bundle.match(/\.legacy-webos(?![\w-])/g) || []).length
  );
  assert.equal(
    (prunedTizen.match(/\.legacy-tizen(?![\w-])/g) || []).length,
    (bundle.match(/\.legacy-tizen(?![\w-])/g) || []).length
  );
}

console.log(
  "CSS platform pruning fixtures passed: comma lists, :not(), similar class names, empty at-rules, keyframes."
);
